import { apiErrorFromBody } from "../errors";
import type { HttpSession } from "./session";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type RequestOptions = {
  body?: unknown;
  /** Same UUID for retries of the same intent. Adapter never mints a new one. */
  idempotencyKey?: string;
  /** Skip X-Business-Id (auth/me/businesses). */
  skipBusiness?: boolean;
};

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly session: HttpSession,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
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
    if (!res.ok) {
      throw apiErrorFromBody(res.status, parsed);
    }
    return parsed as T;
  }
}
