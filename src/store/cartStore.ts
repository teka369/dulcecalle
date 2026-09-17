"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { CartItem, PaymentKind } from "@/domain/types";

type CartState = {
  items: CartItem[];
  paymentKind: PaymentKind;
  customerId: number | null;
  amountReceived: number | null;
};

const listeners = new Set<() => void>();

let state: CartState = {
  items: [],
  paymentKind: "paid",
  customerId: null,
  amountReceived: null,
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
    });
  },
  setQty(productId: number, qty: number) {
    setState((s) => {
      const next = s.items.filter((i) => i.productId !== productId);
      if (qty > 0) next.push({ productId, qty });
      return { ...s, items: next };
    });
  },
  setPaymentKind(paymentKind: PaymentKind) {
    setState((s) => ({
      ...s,
      paymentKind,
      amountReceived: paymentKind === "credit" ? 0 : null,
      customerId: paymentKind === "paid" ? null : s.customerId,
    }));
  },
  setCustomerId(customerId: number | null) {
    setState({ customerId });
  },
  setAmountReceived(amountReceived: number | null) {
    setState({ amountReceived });
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

  const setQty = useCallback((productId: number, qty: number) => {
    cartStore.setQty(productId, qty);
  }, []);

  return {
    ...snap,
    totalQty,
    setQty,
    clear: cartStore.clear,
    setPaymentKind: cartStore.setPaymentKind,
    setCustomerId: cartStore.setCustomerId,
    setAmountReceived: cartStore.setAmountReceived,
  };
}
