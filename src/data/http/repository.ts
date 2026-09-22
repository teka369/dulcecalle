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
  mapProductImage,
  mapSale,
  mapSession,
  mapToday,
  mapCashMove,
  mapStockMove,
  mapExpense,
  mapSupplier,
  mapReturn,
  mapInitialDebt,
  type RemoteCustomer,
  type RemotePayment,
  type RemoteProduct,
  type RemoteProductImage,
  type RemoteSale,
  type RemoteSession,
  type RemoteToday,
  type RemoteCashMove,
  type RemoteStockMove,
  type RemoteExpense,
  type RemoteSupplier,
  type RemoteReturn,
  type RemoteInitialDebt,
  type RemoteStats,
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

  constructor(
    baseUrl: string,
    session: HttpSession = new HttpSession(),
    fetchImpl?: typeof fetch,
  ) {
    this.session = session;
    this.http = new HttpClient(baseUrl, session, fetchImpl);
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

    patch: async (
      id: string,
      input: PatchProductInput,
      requestId?: string,
    ): Promise<RemoteProduct> => {
      const row = await this.http.request<Record<string, unknown>>(
        "PATCH",
        `/products/${id}`,
        requestId ? { body: input, idempotencyKey: requestId } : { body: input },
      );
      return mapProduct(row);
    },

    archive: async (id: string, requestId?: string): Promise<RemoteProduct> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/products/${id}/archive`,
        requestId ? { idempotencyKey: requestId } : {},
      );
      return mapProduct(row);
    },

    imageSignature: async (
      id: string,
      requestId: string,
    ): Promise<{
      cloudName: string;
      apiKey: string;
      uploadUrl: string;
      timestamp: number;
      signature: string;
      publicId: string;
      requestId: string;
    }> => {
      return this.http.request<{
        cloudName: string;
        apiKey: string;
        uploadUrl: string;
        timestamp: number;
        signature: string;
        publicId: string;
        requestId: string;
      }>("POST", `/products/${id}/image-signature`, {
        body: { requestId },
        idempotencyKey: requestId,
      });
    },

    registerImage: async (
      productId: string,
      input: {
        publicId: string;
        secureUrl: string;
        resourceType?: string;
        version?: number;
        width?: number;
        height?: number;
        format?: string;
        bytes?: number;
        isPrimary?: boolean;
        altText?: string;
      },
      requestId: string,
    ): Promise<RemoteProductImage> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/products/${productId}/images`,
        // The backend contract requires requestId in BOTH places: the DTO
        // validates body.requestId (@IsUUID) and resolveIdempotencyKey
        // matches it against the Idempotency-Key header. Omitting the body
        // field answers 400 "requestId must be a UUID".
        { body: { ...input, requestId }, idempotencyKey: requestId },
      );
      return mapProductImage(row);
    },

    listImages: async (productId: string): Promise<RemoteProductImage[]> => {
      const rows = await this.http.request<Record<string, unknown>[]>(
        "GET",
        `/products/${productId}/images`,
      );
      return rows.map(mapProductImage);
    },

    patchImage: async (
      productId: string,
      imageId: string,
      input: { isPrimary?: boolean; altText?: string },
    ): Promise<RemoteProductImage> => {
      const row = await this.http.request<Record<string, unknown>>(
        "PATCH",
        `/products/${productId}/images/${imageId}`,
        { body: input },
      );
      return mapProductImage(row);
    },

    reorderImages: async (
      productId: string,
      imageIds: string[],
    ): Promise<RemoteProductImage[]> => {
      const rows = await this.http.request<Record<string, unknown>[]>(
        "PATCH",
        `/products/${productId}/images/reorder`,
        { body: { imageIds } },
      );
      return rows.map(mapProductImage);
    },

    removeImage: async (
      productId: string,
      imageId: string,
    ): Promise<{ deleted: boolean; id: string }> => {
      return this.http.request<{ deleted: boolean; id: string }>(
        "DELETE",
        `/products/${productId}/images/${imageId}`,
      );
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

    create: async (
      input: {
        name: string;
        phone?: string;
      },
      requestId: string,
    ): Promise<RemoteCustomer> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/customers",
        { body: input, idempotencyKey: requestId },
      );
      return mapCustomer(row);
    },

    patch: async (
      id: string,
      input: { name?: string; phone?: string | null },
      requestId?: string,
    ): Promise<RemoteCustomer> => {
      const row = await this.http.request<Record<string, unknown>>(
        "PATCH",
        `/customers/${id}`,
        requestId ? { body: input, idempotencyKey: requestId } : { body: input },
      );
      return mapCustomer(row);
    },

    pay: async (
      customerId: string,
      input: { amount: number; method: "Efectivo" | "Nequi"; note?: string },
      requestId: string,
    ): Promise<RemotePayment> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/customers/${customerId}/payments`,
        { body: input, idempotencyKey: requestId },
      );
      return mapPayment(row);
    },

    initialDebt: async (
      customerId: string,
      input: { amount: number; note?: string },
      requestId: string,
    ): Promise<RemoteInitialDebt> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/customers/${customerId}/initial-debts`,
        { body: input, idempotencyKey: requestId },
      );
      return mapInitialDebt(row);
    },

    ledger: async (customerId: string) => {
      return this.http.request<{
        customer: Record<string, unknown>;
        initials: Record<string, unknown>[];
        sales: Array<Record<string, unknown> & { returns?: Record<string, unknown>[] }>;
        payments: Record<string, unknown>[];
      }>("GET", `/customers/${customerId}/ledger`);
    },
  };

  readonly suppliers = {
    list: async (): Promise<RemoteSupplier[]> => {
      const rows = await this.http.request<Record<string, unknown>[]>(
        "GET",
        "/suppliers",
      );
      return rows.map(mapSupplier);
    },

    get: async (id: string): Promise<RemoteSupplier> => {
      const row = await this.http.request<Record<string, unknown>>(
        "GET",
        `/suppliers/${id}`,
      );
      return mapSupplier(row);
    },

    create: async (
      input: {
        name: string;
        phone?: string;
        notes?: string;
      },
      requestId: string,
    ): Promise<RemoteSupplier> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/suppliers",
        { body: input, idempotencyKey: requestId },
      );
      return mapSupplier(row);
    },

    patch: async (
      id: string,
      input: { name?: string; phone?: string | null; notes?: string | null },
      requestId?: string,
    ): Promise<RemoteSupplier> => {
      const row = await this.http.request<Record<string, unknown>>(
        "PATCH",
        `/suppliers/${id}`,
        requestId ? { body: input, idempotencyKey: requestId } : { body: input },
      );
      return mapSupplier(row);
    },

    surtidas: async (id: string) => {
      return this.http.request<
        Array<{
          moveId: string;
          createdAt: string;
          productId: string;
          productName: string;
          qty: number;
          unitCost: number;
          totalCost: number;
          method: string | null;
        }>
      >("GET", `/suppliers/${id}/surtidas`);
    },
  };

  readonly inventory = {
    surtir: async (
      productId: string,
      input: {
        qty: number;
        unitCost: number;
        totalCost: number;
        method: "Efectivo" | "Nequi";
        supplierId?: string | null;
        note?: string;
      },
      requestId: string,
    ): Promise<RemoteStockMove> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/products/${productId}/surtir`,
        { body: input, idempotencyKey: requestId },
      );
      return mapStockMove(row);
    },

    shrink: async (
      productId: string,
      input: {
        qty: number;
        reason: "me_lo_comi" | "regalar" | "perdido";
        note?: string;
      },
      requestId: string,
    ): Promise<RemoteStockMove> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/products/${productId}/shrink`,
        { body: input, idempotencyKey: requestId },
      );
      return mapStockMove(row);
    },

    moves: async (productId: string): Promise<RemoteStockMove[]> => {
      const rows = await this.http.request<Record<string, unknown>[]>(
        "GET",
        `/products/${productId}/moves`,
      );
      return rows.map(mapStockMove);
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

    returns: async (saleId: string): Promise<RemoteReturn[]> => {
      const rows = await this.http.request<Record<string, unknown>[]>(
        "GET",
        `/sales/${saleId}/returns`,
      );
      return rows.map(mapReturn);
    },

    createReturn: async (
      saleId: string,
      input: { lines: Array<{ saleLineId: string; qty: number }>; note?: string },
      requestId: string,
    ): Promise<RemoteReturn> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/sales/${saleId}/returns`,
        { body: input, idempotencyKey: requestId },
      );
      return mapReturn(row);
    },
  };

  readonly cash = {
    open: async (openingFloat: number, requestId: string = crypto.randomUUID()): Promise<RemoteSession> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/cash/sessions",
        { body: { openingFloat }, idempotencyKey: requestId },
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
      requestId: string = crypto.randomUUID(),
    ): Promise<RemoteSession> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        `/cash/sessions/${sessionId}/close`,
        { body: { countedEfectivo }, idempotencyKey: requestId },
      );
      return mapSession(row);
    },

    moves: async (date?: string, from?: string, to?: string) => {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      else if (date) q.set("date", date);
      const suffix = q.size ? `?${q.toString()}` : "";
      const rows = await this.http.request<Record<string, unknown>[]>(
        "GET",
        `/cash/moves${suffix}`,
      );
      return rows.map(mapCashMove);
    },

    aporte: async (
      input: { amount: number; method: "Efectivo" | "Nequi"; note?: string },
      requestId: string,
    ): Promise<RemoteCashMove> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/cash/aportes",
        { body: input, idempotencyKey: requestId },
      );
      return mapCashMove(row);
    },

    retiro: async (
      input: { amount: number; method: "Efectivo" | "Nequi"; note?: string },
      requestId: string,
    ): Promise<RemoteCashMove> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/cash/retiros",
        { body: input, idempotencyKey: requestId },
      );
      return mapCashMove(row);
    },

    expenses: async (from?: string, to?: string): Promise<RemoteExpense[]> => {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const suffix = q.size ? `?${q.toString()}` : "";
      const rows = await this.http.request<Record<string, unknown>[]>(
        "GET",
        `/expenses${suffix}`,
      );
      return rows.map(mapExpense);
    },

    recordExpense: async (
      input: {
        amount: number;
        category: string;
        method: "Efectivo" | "Nequi";
        note?: string;
      },
      requestId: string,
    ): Promise<RemoteExpense> => {
      const row = await this.http.request<Record<string, unknown>>(
        "POST",
        "/expenses",
        { body: input, idempotencyKey: requestId },
      );
      return mapExpense(row);
    },
  };

  readonly stats = {
    get: async (period: "hoy" | "semana" | "mes"): Promise<RemoteStats> => {
      return this.http.request<RemoteStats>(
        "GET",
        `/stats?period=${encodeURIComponent(period)}`,
      );
    },
  };

  readonly business = {
    resetData: async (): Promise<{
      deleted: Record<string, number>;
      deletedCustomerIds: string[];
    }> => {
      return this.http.request<{
        deleted: Record<string, number>;
        deletedCustomerIds: string[];
      }>("DELETE", "/business/data");
    },
  };
}

export function createHttpRepository(baseUrl: string): HttpRepository {
  return new HttpRepository(baseUrl);
}
