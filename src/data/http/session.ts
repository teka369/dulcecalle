/**
 * Auth/tenancy for the HTTP adapter.
 * Persists in localStorage (`dulcecalle.auth`) so a reload keeps tokens.
 * Not Dexie. Tokens never go in NEXT_PUBLIC_*. Passwords are never stored.
 */

export type AuthUser = { id: string; email: string };

export type AuthStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const AUTH_STORAGE_KEY = "dulcecalle.auth";

function browserStorage(): AuthStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

type Persisted = {
  accessToken: string | null;
  refreshToken: string | null;
  businessId: string | null;
  user: AuthUser | null;
};

export class HttpSession {
  private _accessToken: string | null = null;
  private _refreshToken: string | null = null;
  private _businessId: string | null = null;
  private _user: AuthUser | null = null;
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

  get businessId(): string | null {
    return this._businessId;
  }
  set businessId(value: string | null) {
    this._businessId = value;
    this.persist();
  }

  get user(): AuthUser | null {
    return this._user;
  }
  set user(value: AuthUser | null) {
    this._user = value;
    this.persist();
  }

  get userId(): string | null {
    return this._user?.id ?? null;
  }
  set userId(value: string | null) {
    if (!value) {
      this._user = null;
    } else if (this._user?.id === value) {
      /* keep email */
    } else {
      this._user = { id: value, email: this._user?.email ?? "" };
    }
    this.persist();
  }

  get authenticated(): boolean {
    // M6.2: a local session is alive while access or refresh remains.
    // Expired access is still a string; missing access + refresh also counts.
    return Boolean(this._accessToken || this._refreshToken);
  }

  clear(): void {
    this._accessToken = null;
    this._refreshToken = null;
    this._businessId = null;
    this._user = null;
    this.persist();
  }

  selectBusiness(businessId: string): void {
    this.businessId = businessId;
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Persisted;
      this._accessToken =
        typeof parsed.accessToken === "string" ? parsed.accessToken : null;
      this._refreshToken =
        typeof parsed.refreshToken === "string" ? parsed.refreshToken : null;
      this._businessId =
        typeof parsed.businessId === "string" ? parsed.businessId : null;
      const u = parsed.user;
      this._user =
        u && typeof u.id === "string" && typeof u.email === "string"
          ? { id: u.id, email: u.email }
          : null;
    } catch {
      this._accessToken = null;
      this._refreshToken = null;
      this._businessId = null;
      this._user = null;
      this.persist();
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      if (
        !this._accessToken &&
        !this._refreshToken &&
        !this._businessId &&
        !this._user
      ) {
        this.storage.removeItem(AUTH_STORAGE_KEY);
        return;
      }
      const payload: Persisted = {
        accessToken: this._accessToken,
        refreshToken: this._refreshToken,
        businessId: this._businessId,
        user: this._user,
      };
      this.storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* private mode */
    }
  }
}

let pwaSession: HttpSession | null = null;

/** Singleton for PWA auth UI. Isolated from Dexie business data. */
export function getPwaAuthSession(): HttpSession {
  if (!pwaSession) pwaSession = new HttpSession();
  return pwaSession;
}

export function resetPwaAuthSessionForTests(): void {
  pwaSession = null;
}
