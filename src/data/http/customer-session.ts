/**
 * Customer portal session. Separate from admin `dulcecalle.auth`.
 * Not a User membership. Tokens never go in NEXT_PUBLIC_*.
 */

import type { AuthStorage } from "./session";

export const CUSTOMER_AUTH_STORAGE_KEY = "dulcecalle.customer.auth";

export type CustomerProfile = {
  id: string;
  code: string;
  name: string;
};

type Persisted = {
  accessToken: string | null;
  refreshToken: string | null;
  customer: CustomerProfile | null;
};

function browserStorage(): AuthStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export class CustomerSession {
  private _accessToken: string | null = null;
  private _refreshToken: string | null = null;
  private _customer: CustomerProfile | null = null;
  private readonly storage: AuthStorage | null;

  constructor(storage: AuthStorage | null = browserStorage()) {
    this.storage = storage;
    this.hydrate();
  }

  get accessToken(): string | null {
    return this._accessToken;
  }
  set accessToken(value: string | null) {
    this._accessToken = value;
    this.persist();
  }

  get refreshToken(): string | null {
    return this._refreshToken;
  }
  set refreshToken(value: string | null) {
    this._refreshToken = value;
    this.persist();
  }

  get customer(): CustomerProfile | null {
    return this._customer;
  }
  set customer(value: CustomerProfile | null) {
    this._customer = value;
    this.persist();
  }

  get authenticated(): boolean {
    return Boolean(this._accessToken);
  }

  clear(): void {
    this._accessToken = null;
    this._refreshToken = null;
    this._customer = null;
    this.persist();
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(CUSTOMER_AUTH_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Persisted;
      this._accessToken =
        typeof parsed.accessToken === "string" ? parsed.accessToken : null;
      this._refreshToken =
        typeof parsed.refreshToken === "string" ? parsed.refreshToken : null;
      const c = parsed.customer;
      this._customer =
        c &&
        typeof c.id === "string" &&
        typeof c.code === "string" &&
        typeof c.name === "string"
          ? { id: c.id, code: c.code, name: c.name }
          : null;
    } catch {
      this._accessToken = null;
      this._refreshToken = null;
      this._customer = null;
      this.persist();
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      if (!this._accessToken && !this._refreshToken && !this._customer) {
        this.storage.removeItem(CUSTOMER_AUTH_STORAGE_KEY);
        return;
      }
      const payload: Persisted = {
        accessToken: this._accessToken,
        refreshToken: this._refreshToken,
        customer: this._customer,
      };
      this.storage.setItem(CUSTOMER_AUTH_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* private mode */
    }
  }
}

let customerSession: CustomerSession | null = null;

export function getCustomerAuthSession(): CustomerSession {
  if (!customerSession) customerSession = new CustomerSession();
  return customerSession;
}

export function resetCustomerAuthSessionForTests(): void {
  customerSession = null;
}
