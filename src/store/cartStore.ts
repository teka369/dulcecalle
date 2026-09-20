"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { CartItem, PayMethod, PaymentKind } from "@/domain/types";

type CartState = {
  items: CartItem[];
  paymentKind: PaymentKind;
  customerId: string | null;
  amountReceived: number | null;
  method: PayMethod;
};

const listeners = new Set<() => void>();

let state: CartState = {
  items: [],
  paymentKind: "paid",
  customerId: null,
  amountReceived: null,
  method: "Efectivo",
};

function emit() {
  listeners.forEach((l) => l());
}

function setState(
  patch: Partial<CartState> | ((s: CartState) => CartState),
) {
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
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
    setState({
      items: [],
      paymentKind: "paid",
      customerId: null,
      amountReceived: null,
      method: "Efectivo",
    });
  },
  setQty(productId: string, qty: number, unitPrice?: number) {
    setState((s) => {
      const existing = s.items.find((i) => i.productId === productId);
      const next = s.items.filter((i) => i.productId !== productId);
      if (qty > 0) {
        next.push({
          productId,
          qty,
          unitPrice: unitPrice ?? existing?.unitPrice,
        });
      }
      return { ...s, items: next };
    });
  },
  setUnitPrice(productId: string, unitPrice: number) {
    setState((s) => ({
      ...s,
      items: s.items.map((i) =>
        i.productId === productId ? { ...i, unitPrice } : i,
      ),
    }));
  },
  setPaymentKind(paymentKind: PaymentKind) {
    setState((s) => ({
      ...s,
      paymentKind,
      amountReceived: paymentKind === "credit" ? 0 : null,
      customerId: paymentKind === "paid" ? null : s.customerId,
    }));
  },
  setCustomerId(customerId: string | null) {
    setState({ customerId });
  },
  setAmountReceived(amountReceived: number | null) {
    setState({ amountReceived });
  },
  setMethod(method: PayMethod) {
    setState({ method });
  },
};

export function useCart() {
  const snap = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSnapshot,
    cartStore.getSnapshot,
  );

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
