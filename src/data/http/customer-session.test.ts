import { describe, expect, it } from "vitest";
import type { AuthStorage } from "./session";
import {
  CUSTOMER_AUTH_STORAGE_KEY,
  CustomerSession,
} from "./customer-session";

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

describe("CustomerSession persist", () => {
  it("writes tokens and profile under a key distinct from admin auth", () => {
    const storage = memoryStorage();
    const session = new CustomerSession(storage);
    session.accessToken = "c-access";
    session.refreshToken = "c-refresh";
    session.customer = { id: "cust-1", code: "DC-0001", name: "Rosa" };

    expect(CUSTOMER_AUTH_STORAGE_KEY).toBe("dulcecalle.customer.auth");
    const raw = storage.getItem(CUSTOMER_AUTH_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.accessToken).toBe("c-access");
    expect(parsed.refreshToken).toBe("c-refresh");
    expect(parsed.customer).toEqual({
      id: "cust-1",
      code: "DC-0001",
      name: "Rosa",
    });
    expect(parsed).not.toHaveProperty("password");
    expect(parsed).not.toHaveProperty("businessId");
    expect(storage.getItem("dulcecalle.auth")).toBeNull();
  });

  it("refresh-only still counts as authenticated; empty storage does not", () => {
    const storage = memoryStorage();
    const empty = new CustomerSession(storage);
    expect(empty.authenticated).toBe(false);

    empty.refreshToken = "c-refresh";
    empty.customer = { id: "id", code: "DC-0001", name: "Rosa" };
    expect(empty.accessToken).toBeNull();
    expect(empty.authenticated).toBe(true);
    expect(new CustomerSession(storage).authenticated).toBe(true);
  });

  it("hydrates after reload and clear() drops the key", () => {
    const storage = memoryStorage();
    const first = new CustomerSession(storage);
    first.accessToken = "a";
    first.refreshToken = "r";
    first.customer = { id: "id", code: "DC-0002", name: "Eva" };

    const reloaded = new CustomerSession(storage);
    expect(reloaded.authenticated).toBe(true);
    expect(reloaded.accessToken).toBe("a");
    expect(reloaded.customer?.code).toBe("DC-0002");

    reloaded.clear();
    expect(reloaded.authenticated).toBe(false);
    expect(storage.getItem(CUSTOMER_AUTH_STORAGE_KEY)).toBeNull();
  });
});
