import {
  ApiError,
  apiErrorFromBody,
  isNetworkError,
  toNetworkError,
} from "../errors";

export type FetchAuthSession = {
  accessToken: string | null;
  refreshToken: string | null;
  businessId?: string | null;
  clear(): void;
};

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type RequestOptions = {
  body?: unknown;
  /** Same UUID for retries of the same intent. Adapter never mints a new one. */
  idempotencyKey?: string;
  /** Skip X-Business-Id (auth/me/businesses). */
  skipBusiness?: boolean;
  /** Do not attempt 401 → refresh → retry (the refresh call itself). */
  skipRefresh?: boolean;
  /** GET only: override the read deadline (e.g. offline prep downloads use 30s). */
  timeoutMs?: number;
};

/** GET reads give up after this long and surface as NetworkError (writes are never timed out). */
export const READ_TIMEOUT_MS = 10_000;
/** Offline-prep downloads (big history reads) get a longer read deadline. */
export const PREP_READ_TIMEOUT_MS = 30_000;

/**
 * Timeout signal for reads. Built on a plain timer (same effect as
 * AbortSignal.timeout, but works on every runtime and under fake timers).
 * `expired` rejects with a TimeoutError so a fetch that ignores the signal
 * still cannot hang the caller.
 */
function readTimeout(ms: number): { signal: AbortSignal; expired: Promise<never>; clear: () => void } {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = typeof DOMException !== "undefined"
        ? new DOMException("The operation timed out.", "TimeoutError")
        : Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
      ctrl.abort(err);
      reject(err);
    }, ms);
  });
  expired.catch(() => undefined);
  return { signal: ctrl.signal, expired, clear: () => clearTimeout(timer) };
}

function isAuthRefreshPath(path: string): boolean {
  return (
    /\/auth\/(refresh|login|register)$/.test(path) ||
    /\/customer-access\/(login|refresh|logout)$/.test(path)
  );
}

export class HttpClient {
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly session: FetchAuthSession,
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
    private readonly refreshPath: string = "/auth/refresh",
    /** Default deadline for GET reads made through this client. */
    private readonly readTimeoutMs: number = READ_TIMEOUT_MS,
  ) {}

  async request<T>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    return this.requestOnce<T>(method, path, opts, false);
  }

  private async requestOnce<T>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions,
    retried: boolean,
  ): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.session.accessToken) {
      headers.Authorization = `Bearer ${this.session.accessToken}`;
    }
    if (!opts.skipBusiness && this.session.businessId) {
      headers["X-Business-Id"] = this.session.businessId;
    }
    if (opts.idempotencyKey) {
      headers["Idempotency-Key"] = opts.idempotencyKey;
    }

    const body =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    // Only GET reads are timed out; POST/PUT/PATCH/DELETE keep no deadline.
    const timeout = method === "GET" ? readTimeout(opts.timeoutMs ?? this.readTimeoutMs) : null;
    let res: Response;
    let text!: string;
    try {
      const request = this.fetchImpl(url, {
        method,
        headers,
        body,
        ...(timeout ? { signal: timeout.signal } : {}),
      });
      res = timeout ? await Promise.race([request, timeout.expired]) : await request;
      if (timeout) text = await Promise.race([res.text(), timeout.expired]);
    } catch (e) {
      timeout?.clear();
      throw toNetworkError(e);
    }
    if (timeout) timeout.clear();
    else text = await res.text();

    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { error: { code: "INTERNAL", message: text } };
      }
    }

    if (
      res.status === 401 &&
      !retried &&
      !opts.skipRefresh &&
      !isAuthRefreshPath(path) &&
      this.session.refreshToken
    ) {
      try {
        await this.refreshTokens();
      } catch (e) {
        // Network / 5xx: keep tokens. Only a real auth rejection logs out.
        if (isNetworkError(e)) throw e;
        if (e instanceof ApiError && e.status !== 401 && e.status !== 403) {
          throw e;
        }
        this.session.clear();
        throw e;
      }
      return this.requestOnce<T>(method, path, opts, true);
    }

    if (!res.ok) {
      throw apiErrorFromBody(res.status, parsed);
    }
    return parsed as T;
  }

  private refreshTokens(): Promise<void> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doRefresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<void> {
    const refreshToken = this.session.refreshToken;
    if (!refreshToken) {
      throw apiErrorFromBody(401, {
        error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
      });
    }
    const body = await this.requestOnce<{
      accessToken: string;
      refreshToken?: string;
    }>(
      "POST",
      this.refreshPath,
      { body: { refreshToken }, skipBusiness: true, skipRefresh: true },
      true,
    );
    this.session.accessToken = body.accessToken;
    if (body.refreshToken) this.session.refreshToken = body.refreshToken;
  }
}
