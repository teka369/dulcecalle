import { apiErrorFromBody } from "../errors";

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
};

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

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
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
