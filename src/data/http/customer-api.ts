import { apiBaseUrl } from "../backend";
import { HttpClient } from "./client";
import { getLocalDb } from "../local/db";
import {
  CustomerSession,
  getCustomerAuthSession,
} from "./customer-session";

export type CustomerMe = {
  id: string;
  code: string;
  name: string;
  debt: number;
  createdAt: string | number;
};

export type CustomerCatalogImage = {
  id: string;
  secureUrl: string;
  position: number;
  isPrimary: boolean;
  altText: string | null;
};

export type CustomerCatalogProduct = {
  id: string;
  name: string;
  price: number;
  available: boolean;
  images: CustomerCatalogImage[];
};

export type CustomerLedgerLine = {
  id: string;
  productName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type CustomerLedgerReturn = {
  id: string;
  refundAmount: number;
  debtReduced: number;
  method: string | null;
  note: string | null;
  occurredOn: string;
  createdAt: string | number;
  lines: Array<{ id: string; qty: number; unitPrice: number }>;
};

export type CustomerLedgerSale = {
  id: string;
  paymentKind: string;
  method: string | null;
  saleTotal: number;
  amountReceived: number;
  credit: number;
  note: string | null;
  occurredOn: string;
  createdAt: string | number;
  lines: CustomerLedgerLine[];
  returns: CustomerLedgerReturn[];
};

export type CustomerLedgerPayment = {
  id: string;
  amount: number;
  method: string;
  occurredOn: string;
  createdAt: string | number;
};

export type CustomerLedgerInitial = {
  id: string;
  amount: number;
  note: string | null;
  occurredOn: string;
  createdAt: string | number;
};

export type CustomerLedger = {
  customer: CustomerMe;
  initials: CustomerLedgerInitial[];
  sales: CustomerLedgerSale[];
  payments: CustomerLedgerPayment[];
};

export class CustomerApi {
  private readonly http: HttpClient;

  constructor(
    baseUrl: string,
    private readonly session: CustomerSession,
    fetchImpl?: typeof fetch,
  ) {
    this.http = new HttpClient(
      baseUrl,
      session,
      fetchImpl,
      "/customer-access/refresh",
    );
  }

  async login(code: string, name: string) {
    const body = await this.http.request<{
      customer: { id: string; code: string; name: string; debt: number };
      accessToken: string;
      refreshToken: string;
    }>("POST", "/customer-access/login", {
      body: { code, name },
      skipBusiness: true,
      skipRefresh: true,
    });
    this.session.accessToken = body.accessToken;
    this.session.refreshToken = body.refreshToken;
    this.session.customer = {
      id: body.customer.id,
      code: body.customer.code,
      name: body.customer.name,
    };
    return body;
  }

  me() {
    return this.http.request<CustomerMe>("GET", "/customer/me", {
      skipBusiness: true,
    });
  }

  ledger() {
    return this.http.request<CustomerLedger>("GET", "/customer/me/ledger", {
      skipBusiness: true,
    });
  }

  products() {
    return this.http.request<CustomerCatalogProduct[]>(
      "GET",
      "/customer/products",
      { skipBusiness: true },
    );
  }

  async logout() {
    const customerId = this.session.customer?.id;
    try {
      await this.http.request<{ ok: boolean }>(
        "POST",
        "/customer-access/logout",
        { skipBusiness: true, skipRefresh: true },
      );
    } catch {
      /* stateless JWT */
    }
    this.session.clear();
    // M6.10 — Never leave the private ledger stored after logout.
    // Only the closing customer's snapshot is removed.
    if (customerId) {
      try {
        const db = getLocalDb();
        await db.customerLedgers.delete(customerId);
        await db.portalCatalogs.delete(customerId);
      } catch {
        /* local-only cleanup; session is already cleared */
      }
    }
    return { ok: true as const };
  }
}

export function getCustomerApi(): CustomerApi {
  const base = apiBaseUrl();
  if (!base) {
    throw new Error("El servidor no está configurado.");
  }
  return new CustomerApi(base, getCustomerAuthSession());
}
