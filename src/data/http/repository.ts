/**
 * HTTP repository adapter. Transport only — no financial formulas.
 * Server remains the authority for stock, debt, totals, cost, caja.
 */
import { HttpClient } from "./client";
import { HttpSession } from "./session";
import {
  mapCustomer,
  mapPayment,
  mapProduct,
  mapSale,
  mapSession,
  mapToday,
  type RemoteCustomer,
  type RemotePayment,
  type RemoteProduct,
  type RemoteSale,
  type RemoteSession,
  type RemoteToday,
} from "./mappers";

export type CreateProductInput = {
  name: string;
  price: number;
  stock?: number;
  avgCost?: number;
  lowStockAt?: number;
  gifted?: boolean;
};

export type PatchProductInput = {
  name?: string;
  price?: number;
  lowStockAt?: number;
  stock?: unknown;
  avgCost?: unknown;
};

export type CreateSaleInput = {
  lines: Array<{ productId: string; qty: number; unitPrice?: number }>;
  paymentKind: "paid" | "partial" | "credit";
  customerId?: string;
  amountReceived: number;
  method?: "Efectivo" | "Nequi";
  note?: string;
};

export class HttpRepository {
  readonly session: HttpSession;
  private readonly http: HttpClient;

  constructor(baseUrl: string, session: HttpSession = new HttpSession()) {
    this.session = session;
    this.http = new HttpClient(baseUrl, session);
  }

  readonly auth = {
    register: async (input: {
      email: string;
      password: string;
      businessName?: string;
    }) => {
      const body = await this.http.request<{
        user: { id: string; email: string };
        business: { id: string; name: string; timezone: string };
        accessToken: string;
        refreshToken: string;
      }>("POST", "/auth/register", { body: input, skipBusiness: true });
      this.session.accessToken = body.accessToken;
      this.session.refreshToken = body.refreshToken;
      this.session.user = body.user;
      this.session.businessId = body.business.id;
      return body;
    },

    login: async (email: string, password: string) => {
      const body = await this.http.request<{
        user: { id: string; email: string };
        accessToken: string;
        refreshToken: string;
      }>("POST", "/auth/login", {
        body: { email, password },
        skipBusiness: true,
      });
      this.session.accessToken = body.accessToken;
      this.session.refreshToken = body.refreshToken;
      this.session.user = body.user;
      this.session.businessId = null;
      const me = await this.auth.me();
      if (me.memberships.length === 1) {
        this.session.selectBusiness(me.memberships[0].businessId);
      }
      return { ...body, memberships: me.memberships };
    },

    logout: async () => {
      try {
        await this.http.request<{ ok: boolean }>("POST", "/auth/logout", {
          skipBusiness: true,
          skipRefresh: true,
        });
      } catch {
        /* JWT is stateless; local clear is logout. */
      }
      this.session.clear();
      return { ok: true as const };
    },

    me: async () => {
      return this.http.request<{
        id: string;
        email: string;
        memberships: Array<{
          businessId: string;
          role: "owner" | "staff";
          business: { id: string; name: string; timezone: string };
        }>;
      }>("GET", "/me", { skipBusiness: true });
    },

    businesses: async () => {
      return this.http.request<
        Array<{ id: string; name: string; timezone: string; role: string }>
      >("GET", "/businesses", { skipBusiness: true });
    },

    selectBusiness: (businessId: string) => {
      this.session.selectBusiness(businessId);
    },
  };

  readonly products = {
    list: async (): Promise<RemoteProduct[]> => {
      const rows = await this.http.request<Record<string, unknown>[]>(
        "GET",
        "/products",
      );
      return rows.map(mapProduct);
    },

    get: async (id: string): Promise<RemoteProduct> => {
      const row = await this.http.request<Record<string, unknown>>(
        "GET",
        `/products/${id}`,
      );
      return mapProduct(row);
    },

    create: async (
      input: CreateProductInput,
      requestId: string,
    ): Promise<RemoteProduct> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/products",
        { body: input, idempotencyKey: requestId },
      );
      return mapProduct(row);
    },

    patch: async (id: string, input: PatchProductInput): Promise<RemoteProduct> => {
      const row = await this.http.request<Record<string, unknown>>(
        "PATCH",
        `/products/${id}`,
        { body: input },
      );
      return mapProduct(row);
    },
  };

  readonly customers = {
    list: async (): Promise<RemoteCustomer[]> => {
      const rows = await this.http.request<Record<string, unknown>[]>(
        "GET",
        "/customers",
      );
      return rows.map(mapCustomer);
    },

    get: async (id: string): Promise<RemoteCustomer> => {
      const row = await this.http.request<Record<string, unknown>>(
        "GET",
        `/customers/${id}`,
      );
      return mapCustomer(row);
    },

    create: async (input: {
      name: string;
      phone?: string;
    }): Promise<RemoteCustomer> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/customers",
        { body: input },
      );
      return mapCustomer(row);
    },

    pay: async (
      customerId: string,
      input: { amount: number; method: "Efectivo" | "Nequi" },
      requestId: string,
    ): Promise<RemotePayment> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/customers/${customerId}/payments`,
        { body: input, idempotencyKey: requestId },
      );
      return mapPayment(row);
    },
  };

  readonly sales = {
    list: async (from?: string, to?: string): Promise<RemoteSale[]> => {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const suffix = q.size ? `?${q.toString()}` : "";
      const rows = await this.http.request<Record<string, unknown>[]>(
        "GET",
        `/sales${suffix}`,
      );
      return rows.map(mapSale);
    },

    get: async (id: string): Promise<RemoteSale> => {
      const row = await this.http.request<Record<string, unknown>>(
        "GET",
        `/sales/${id}`,
      );
      return mapSale(row);
    },

    create: async (
      input: CreateSaleInput,
      requestId: string,
    ): Promise<RemoteSale> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/sales",
        { body: input, idempotencyKey: requestId },
      );
      return mapSale(row);
    },
  };

  readonly cash = {
    open: async (openingFloat: number): Promise<RemoteSession> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/cash/sessions",
        { body: { openingFloat } },
      );
      return mapSession(row);
    },

    today: async (): Promise<RemoteToday> => {
      const row = await this.http.request<Record<string, unknown>>(
        "GET",
        "/cash/today",
      );
      return mapToday(row);
    },

    close: async (
      sessionId: string,
      countedEfectivo: number,
    ): Promise<RemoteSession> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/cash/sessions/${sessionId}/close`,
        { body: { countedEfectivo } },
      );
      return mapSession(row);
    },

    moves: async (date?: string) => {
      const suffix = date ? `?date=${encodeURIComponent(date)}` : "";
      return this.http.request<unknown[]>("GET", `/cash/moves${suffix}`);
    },
  };
}

export function createHttpRepository(baseUrl: string): HttpRepository {
  return new HttpRepository(baseUrl);
}
