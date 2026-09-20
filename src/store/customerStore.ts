"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { PayMethod } from "@/domain/types";
import {
  CUSTOMER_ERRORS,
  parseAbonoAmount,
  validateAbono,
} from "@/domain/abono";
import {
  INITIAL_DEBT_TOAST,
  parseInitialDebtAmount,
  validateInitialDebtAmount,
} from "@/domain/initialDebt";
import { ApiError } from "@/data/errors";
import { getPwaApi } from "@/data/pwa/api";
import { getCachedCustomer, listCachedCustomers } from "@/data/pwa/catalog";
import { createPaymentWithOfflineFallback } from "@/data/pwa/offline-payments";
import { createCustomerWithOfflineFallback } from "@/data/pwa/offline-catalog";
import { loadHttpStatement } from "@/data/pwa/statement";
import type { RemoteCustomer } from "@/data/http/mappers";
import type { DebtStatement } from "@/domain/debt/statement";

type CustomerState = {
  customers: RemoteCustomer[];
  loading: boolean;
  lastToast: string | null;
};

const listeners = new Set<() => void>();

let state: CustomerState = {
  customers: [],
  loading: false,
  lastToast: null,
};

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<CustomerState>) {
  state = { ...state, ...patch };
  emit();
}

function fail(e: unknown): never {
  if (e instanceof ApiError) throw new Error(e.message);
  if (e instanceof Error) throw e;
  throw new Error("Algo salió mal.");
}

export const customerStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): CustomerState {
    return state;
  },
  async refresh(): Promise<RemoteCustomer[]> {
    setState({ loading: true });
    try {
      const customers = await listCachedCustomers();
      setState({ customers, loading: false });
      return customers;
    } catch (e) {
      setState({ loading: false });
      fail(e);
    }
  },
  async createCustomer(name: string): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error(CUSTOMER_ERRORS.emptyName);
    try {
      const result = await createCustomerWithOfflineFallback(
        { name: trimmed },
        crypto.randomUUID(),
      );
      await this.refresh();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Cliente guardado sin conexión"
            : "Cliente guardado",
      });
      return result.mode === "offline" ? result.customerId : result.customer.id;
    } catch (e) {
      fail(e);
    }
  },
  async getCustomer(id: string): Promise<RemoteCustomer | undefined> {
    try {
      return await getCachedCustomer(id);
    } catch {
      return undefined;
    }
  },
  async getStatement(id: string): Promise<DebtStatement | null> {
    try {
      return await loadHttpStatement(id);
    } catch {
      return null;
    }
  },
  async recordAbono(input: {
    customerId: string;
    amountRaw: string;
    method: PayMethod | null;
    requestId?: string;
  }): Promise<{ id: string; mode: "online" | "offline" }> {
    const customer = await this.getCustomer(input.customerId);
    if (!customer) throw new Error("customer not found");

    const error = validateAbono({
      amountRaw: input.amountRaw,
      debt: customer.debt,
      method: input.method,
    });
    if (error) throw new Error(error);

    const amount = parseAbonoAmount(input.amountRaw);
    try {
      const result = await createPaymentWithOfflineFallback(
        {
          customerId: input.customerId,
          amount,
          method: input.method as PayMethod,
        },
        input.requestId ?? crypto.randomUUID(),
      );
      await this.refresh();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Abono guardado sin conexión"
            : "Abono registrado",
      });
      return {
        id: result.mode === "offline" ? result.paymentId : result.payment.id,
        mode: result.mode,
      };
    } catch (e) {
      fail(e);
    }
  },
  async recordInitialDebt(input: {
    customerId: string;
    amountRaw: string;
    requestId?: string;
  }): Promise<string> {
    const customer = await this.getCustomer(input.customerId);
    if (!customer) throw new Error("customer not found");

    const error = validateInitialDebtAmount(input.amountRaw);
    if (error) throw new Error(error);

    const amount = parseInitialDebtAmount(input.amountRaw);
    try {
      const row = await getPwaApi().customers.initialDebt(
        input.customerId,
        { amount },
        input.requestId ?? crypto.randomUUID(),
      );
      await this.refresh();
      setState({ lastToast: INITIAL_DEBT_TOAST });
      return row.id;
    } catch (e) {
      fail(e);
    }
  },
  clearToast() {
    setState({ lastToast: null });
  },
};

export function useCustomers() {
  const snap = useSyncExternalStore(
    customerStore.subscribe,
    customerStore.getSnapshot,
    customerStore.getSnapshot,
  );

  const refresh = useCallback(() => customerStore.refresh(), []);
  const createCustomer = useCallback(
    (name: string) => customerStore.createCustomer(name),
    [],
  );
  const recordAbono = useCallback(
    (input: {
      customerId: string;
      amountRaw: string;
      method: PayMethod | null;
      requestId?: string;
    }) => customerStore.recordAbono(input),
    [],
  );
  const recordInitialDebt = useCallback(
    (input: {
      customerId: string;
      amountRaw: string;
      requestId?: string;
    }) => customerStore.recordInitialDebt(input),
    [],
  );

  return {
    ...snap,
    refresh,
    createCustomer,
    recordAbono,
    recordInitialDebt,
    getCustomer: customerStore.getCustomer,
    getStatement: customerStore.getStatement,
    clearToast: customerStore.clearToast,
  };
}
