import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __detachCartMemoryForTests,
  cartStore,
  hydrateCartFromSession,
} from "./cartStore";

const KEY = "dulcecalle:cart:v1";

function installSession() {
  const map = new Map<string, string>();
  const box = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  vi.stubGlobal("sessionStorage", box);
  return box;
}

describe("cart session snapshot", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installSession();
    __detachCartMemoryForTests();
    sessionStorage.removeItem(KEY);
  });

  it("persists items when the qty changes", () => {
    cartStore.setQty("prod-1", 2, 1500);
    const raw = sessionStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw!) as { v: number; items: Array<{ productId: string; qty: number }> };
    expect(stored.v).toBe(1);
    expect(stored.items).toEqual([{ productId: "prod-1", qty: 2, unitPrice: 1500 }]);
  });

  it("updates the snapshot when the payment kind changes", () => {
    cartStore.setQty("prod-1", 1);
    cartStore.setCustomerId("cust-1");
    cartStore.setPaymentKind("credit");
    const stored = JSON.parse(sessionStorage.getItem(KEY)!) as {
      paymentKind: string;
      amountReceived: number | null;
      customerId: string | null;
    };
    expect(stored.paymentKind).toBe("credit");
    expect(stored.amountReceived).toBe(0);
    expect(stored.customerId).toBe("cust-1");
  });

  it("removes the snapshot on clear", () => {
    cartStore.setQty("prod-1", 1);
    expect(sessionStorage.getItem(KEY)).toBeTruthy();
    cartStore.clear();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it("drops a corrupt snapshot and keeps an empty cart", () => {
    sessionStorage.setItem(KEY, "{not json");
    hydrateCartFromSession();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(cartStore.getSnapshot().items).toEqual([]);
    expect(cartStore.getSnapshot().hydrated).toBe(true);
  });

  it("drops a snapshot with an incompatible schema", () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, items: [{ productId: "x", qty: 0 }] }));
    hydrateCartFromSession();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it("recovers items after the in-memory cart is discarded", () => {
    cartStore.setQty("prod-1", 3, 800);
    cartStore.setMethod("Nequi");
    cartStore.setPaymentKind("partial");
    cartStore.setAmountReceived(500);
    __detachCartMemoryForTests();
    expect(cartStore.getSnapshot().items).toEqual([]);
    hydrateCartFromSession();
    const snap = cartStore.getSnapshot();
    expect(snap.items).toEqual([{ productId: "prod-1", qty: 3, unitPrice: 800 }]);
    expect(snap.method).toBe("Nequi");
    expect(snap.paymentKind).toBe("partial");
    expect(snap.amountReceived).toBe(500);
    expect(snap.hydrated).toBe(true);
  });
});
