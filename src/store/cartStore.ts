"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { CartItem, PayMethod, PaymentKind } from "@/domain/types";

const CART_STORAGE_KEY = "dulcecalle:cart:v1";

type CartFields = {
  items: CartItem[];
  paymentKind: PaymentKind;
  customerId: string | null;
  amountReceived: number | null;
  method: PayMethod;
};

type CartState = CartFields & { hydrated: boolean };

const listeners = new Set<() => void>();

function emptyFields(): CartFields {
  return {
    items: [],
    paymentKind: "paid",
    customerId: null,
    amountReceived: null,
    method: "Efectivo",
  };
}

let state: CartState = { ...emptyFields(), hydrated: false };

function emit() {
  listeners.forEach((l) => l());
}

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function isPaymentKind(value: unknown): value is PaymentKind {
  return value === "paid" || value === "partial" || value === "credit";
}

function isPayMethod(value: unknown): value is PayMethod {
  return value === "Efectivo" || value === "Nequi";
}

function parseStored(raw: string): CartFields | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  if (row.v !== 1 || !Array.isArray(row.items)) return null;
  if (!isPaymentKind(row.paymentKind) || !isPayMethod(row.method)) return null;
  if (row.customerId != null && typeof row.customerId !== "string") return null;
  if (
    row.amountReceived != null &&
    (typeof row.amountReceived !== "number" || !Number.isFinite(row.amountReceived))
  ) {
    return null;
  }
  const items: CartItem[] = [];
  for (const item of row.items) {
    if (!item || typeof item !== "object") return null;
    const line = item as Record<string, unknown>;
    if (typeof line.productId !== "string" || line.productId.length === 0) return null;
    if (!Number.isInteger(line.qty) || (line.qty as number) <= 0) return null;
    if (line.unitPrice != null) {
      if (!Number.isInteger(line.unitPrice) || (line.unitPrice as number) < 0) return null;
    }
    items.push({
      productId: line.productId,
      qty: line.qty as number,
      unitPrice: line.unitPrice == null ? undefined : (line.unitPrice as number),
    });
  }
  return {
    items,
    paymentKind: row.paymentKind,
    customerId: (row.customerId as string | null) ?? null,
    amountReceived: (row.amountReceived as number | null) ?? null,
    method: row.method,
  };
}

function persist() {
  const box = storage();
  if (!box) return;
  try {
    box.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        items: state.items,
        paymentKind: state.paymentKind,
        customerId: state.customerId,
        amountReceived: state.amountReceived,
        method: state.method,
      }),
    );
  } catch {
    /* quota or private mode: the in-memory cart still works for this document */
  }
}

function dropStored() {
  const box = storage();
  if (!box) return;
  try {
    box.removeItem(CART_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function setFields(next: CartFields) {
  state = { ...next, hydrated: state.hydrated };
  persist();
  emit();
}

/**
 * Read sessionStorage once, after mount. Never during SSR: the first
 * client render stays on the empty snapshot so hydration matches.
 */
export function hydrateCartFromSession(): void {
  if (state.hydrated) return;
  const box = storage();
  let fields: CartFields | null = null;
  if (box) {
    let raw: string | null = null;
    try {
      raw = box.getItem(CART_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (raw) {
      fields = parseStored(raw);
      if (!fields) dropStored();
    }
  }
  state = { ...(fields ?? emptyFields()), hydrated: true };
  emit();
}

/** Test-only: drop memory without touching sessionStorage, as a new document would. */
export function __detachCartMemoryForTests(): void {
  state = { ...emptyFields(), hydrated: false };
  emit();
}

export const cartStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): CartState {
    return state;
  },
  clear() {
    state = { ...emptyFields(), hydrated: true };
    dropStored();
    emit();
  },
  setQty(productId: string, qty: number, unitPrice?: number) {
    const existing = state.items.find((i) => i.productId === productId);
    const next = state.items.filter((i) => i.productId !== productId);
    if (qty > 0) {
      next.push({
        productId,
        qty,
        unitPrice: unitPrice ?? existing?.unitPrice,
      });
    }
    setFields({ ...state, items: next });
  },
  setUnitPrice(productId: string, unitPrice: number) {
    setFields({
      ...state,
      items: state.items.map((i) =>
        i.productId === productId ? { ...i, unitPrice } : i,
      ),
    });
  },
  setPaymentKind(paymentKind: PaymentKind) {
    setFields({
      ...state,
      paymentKind,
      amountReceived: paymentKind === "credit" ? 0 : null,
      customerId: paymentKind === "paid" ? null : state.customerId,
    });
  },
  setCustomerId(customerId: string | null) {
    setFields({ ...state, customerId });
  },
  setAmountReceived(amountReceived: number | null) {
    setFields({ ...state, amountReceived });
  },
  setMethod(method: PayMethod) {
    setFields({ ...state, method });
  },
};

export function useCart() {
  const snap = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSnapshot,
    cartStore.getSnapshot,
  );

  useEffect(() => {
    hydrateCartFromSession();
  }, []);

  const totalQty = useMemo(
    () => snap.items.reduce((s, i) => s + i.qty, 0),
    [snap.items],
  );

  const setQty = useCallback((productId: string, qty: number, unitPrice?: number) => {
    cartStore.setQty(productId, qty, unitPrice);
  }, []);

  const setUnitPrice = useCallback((productId: string, unitPrice: number) => {
    cartStore.setUnitPrice(productId, unitPrice);
  }, []);

  return {
    ...snap,
    totalQty,
    setQty,
    setUnitPrice,
    clear: cartStore.clear,
    setPaymentKind: cartStore.setPaymentKind,
    setCustomerId: cartStore.setCustomerId,
    setAmountReceived: cartStore.setAmountReceived,
    setMethod: cartStore.setMethod,
  };
}
