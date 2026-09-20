import { describe, expect, it } from "vitest";
import {
  AUTH_STORAGE_KEY,
  HttpSession,
  type AuthStorage,
} from "./session";

function memoryStorage(initial?: Record<string, string>): AuthStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

describe("HttpSession persist", () => {
  it("writes access, refresh, user and businessId — never a password", () => {
    const storage = memoryStorage();
    const session = new HttpSession(storage);
    session.accessToken = "access-1";
    session.refreshToken = "refresh-1";
    session.user = { id: "u1", email: "a@test.co" };
    session.businessId = "biz-1";

    const raw = storage.getItem(AUTH_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.accessToken).toBe("access-1");
    expect(parsed.refreshToken).toBe("refresh-1");
    expect(parsed.businessId).toBe("biz-1");
    expect(parsed.user).toEqual({ id: "u1", email: "a@test.co" });
    expect(parsed).not.toHaveProperty("password");
    expect(JSON.stringify(parsed)).not.toMatch(/password/i);
  });

  it("treats refresh-only as an authenticated local session (expired access)", () => {
    const storage = memoryStorage();
    const session = new HttpSession(storage);
    session.refreshToken = "refresh-only";
    session.user = { id: "u1", email: "a@test.co" };
    session.businessId = "biz-1";
    expect(session.accessToken).toBeNull();
    expect(session.authenticated).toBe(true);

    const reloaded = new HttpSession(storage);
    expect(reloaded.authenticated).toBe(true);
    expect(reloaded.refreshToken).toBe("refresh-only");
    expect(reloaded.businessId).toBe("biz-1");
  });

  it("empty storage is not an invented session", () => {
    const session = new HttpSession(memoryStorage());
    expect(session.authenticated).toBe(false);
    expect(session.accessToken).toBeNull();
    expect(session.refreshToken).toBeNull();
    expect(session.businessId).toBeNull();
    expect(session.user).toBeNull();
  });

  it("hydrates a new session from the same store (reload)", () => {
    const storage = memoryStorage();
    const first = new HttpSession(storage);
    first.accessToken = "access-2";
    first.refreshToken = "refresh-2";
    first.user = { id: "u2", email: "b@test.co" };
    first.selectBusiness("biz-2");

    const reloaded = new HttpSession(storage);
    expect(reloaded.accessToken).toBe("access-2");
    expect(reloaded.refreshToken).toBe("refresh-2");
    expect(reloaded.user).toEqual({ id: "u2", email: "b@test.co" });
    expect(reloaded.userId).toBe("u2");
    expect(reloaded.businessId).toBe("biz-2");
    expect(reloaded.authenticated).toBe(true);
  });

  it("clear() removes the storage key", () => {
    const storage = memoryStorage();
    const session = new HttpSession(storage);
    session.accessToken = "access-3";
    session.refreshToken = "refresh-3";
    session.clear();
    expect(storage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(session.authenticated).toBe(false);
    expect(session.accessToken).toBeNull();
    expect(session.refreshToken).toBeNull();
    expect(session.businessId).toBeNull();
    expect(session.user).toBeNull();
  });

  it("ignores corrupt storage and works without a store", () => {
    const bad = memoryStorage({ [AUTH_STORAGE_KEY]: "{not-json" });
    const fromBad = new HttpSession(bad);
    expect(fromBad.accessToken).toBeNull();
    expect(bad.getItem(AUTH_STORAGE_KEY)).toBeNull();

    const memoryOnly = new HttpSession(null);
    memoryOnly.accessToken = "only-ram";
    expect(memoryOnly.accessToken).toBe("only-ram");
  });
});

function unsignedJwt(payload: Record<string, unknown>): string {
  const b64url = (value: string) =>
    Buffer.from(value, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(payload))}.sig`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("HttpSession authenticated vs refresh exp", () => {
  it("1. future refresh → authenticated", () => {
    const session = new HttpSession(memoryStorage());
    session.refreshToken = unsignedJwt({ exp: nowSec() + 7 * 24 * 3600 });
    session.businessId = "biz-a";
    expect(session.authenticated).toBe(true);
  });

  it("2. expired refresh → not authenticated", () => {
    const session = new HttpSession(memoryStorage());
    session.refreshToken = unsignedJwt({ exp: nowSec() - 60 });
    session.businessId = "biz-a";
    expect(session.authenticated).toBe(false);
  });

  it("3. expired access + future refresh → authenticated", () => {
    const session = new HttpSession(memoryStorage());
    session.accessToken = unsignedJwt({ exp: nowSec() - 60 });
    session.refreshToken = unsignedJwt({ exp: nowSec() + 3600 });
    session.businessId = "biz-a";
    expect(session.authenticated).toBe(true);
  });

  it("4. future access + expired refresh → not authenticated", () => {
    const session = new HttpSession(memoryStorage());
    session.accessToken = unsignedJwt({ exp: nowSec() + 900 });
    session.refreshToken = unsignedJwt({ exp: nowSec() - 60 });
    session.businessId = "biz-a";
    expect(session.authenticated).toBe(false);
  });

  it("5. both expired → not authenticated", () => {
    const session = new HttpSession(memoryStorage());
    session.accessToken = unsignedJwt({ exp: nowSec() - 60 });
    session.refreshToken = unsignedJwt({ exp: nowSec() - 7 * 24 * 3600 });
    session.businessId = "biz-a";
    expect(session.authenticated).toBe(false);
  });

  it("6. non-JWT tokens keep presence compatibility", () => {
    const storage = memoryStorage();
    const session = new HttpSession(storage);
    session.accessToken = "expired";
    session.refreshToken = "r1";
    session.businessId = "biz-a";
    expect(session.authenticated).toBe(true);
    expect(new HttpSession(storage).authenticated).toBe(true);
  });
});
