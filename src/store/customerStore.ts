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
import { getCachedCustomer, listCachedCustomersResult, peekLocalCustomers } from "@/data/pwa/catalog";
import { EMPTY_LIST_STATUS, listErrorMessage, type ListReadStatus } from "@/data/pwa/list-status";
import { createPaymentWithOfflineFallback } from "@/data/pwa/offline-payments";
import {
  createCustomerWithOfflineFallback,
  patchCustomerWithOfflineFallback,
} from "@/data/pwa/offline-catalog";
import { getStatementWithOfflineFallback } from "@/data/pwa/offline-statement";
import { createInitialDebtWithOfflineFallback } from "@/data/pwa/offline-initial-debt";
import type { RemoteCustomer } from "@/data/http/mappers";
import type { DebtStatement } from "@/domain/debt/statement";

type CustomerState = {
  customers: RemoteCustomer[];
  /** B3: where the list came from / last read error (never a false empty). */
  listStatus: ListReadStatus;
  loading: boolean;
  lastToast: string | null;
};

const listeners = new Set<() => void>();

let state: CustomerState = {
  customers: [],
  listStatus: EMPTY_LIST_STATUS,
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
    let settled = false;
    // Hero-first paint: show this device's rows while a slow server read runs.
    if (state.customers.length === 0) {
      void peekLocalCustomers().then((rows) => {
        if (!settled && rows && rows.length > 0 && state.customers.length === 0) setState({ customers: rows });
      });
    }
    try {
      const result = await listCachedCustomersResult();
      settled = true;
      const customers = result.data;
      setState({
        customers,
        loading: false,
        listStatus: { source: result.source, cachedAt: result.cachedAt, error: null },
      });
      return customers;
    } catch (e) {
      settled = true;
      setState({ loading: false, listStatus: { ...state.listStatus, error: listErrorMessage(e) } });
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
  async setCustomerPin(customerId: string, pin: string): Promise<void> {
    if (!/^\d{6}$/.test(pin)) {
      throw new Error("El PIN debe tener 6 dígitos.");
    }
    try {
      await getPwaApi().customers.setPin(customerId, pin);
    } catch (e) {
      fail(e);
    }
  },
  async patchCustomer(input: {
    customerId: string;
    name: string;
    phone?: string | null;
    requestId?: string;
  }): Promise<"online" | "offline"> {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error(CUSTOMER_ERRORS.emptyName);
    try {
      const result = await patchCustomerWithOfflineFallback(
        input.customerId,
        { name: trimmed, phone: input.phone ?? null },
        input.requestId ?? crypto.randomUUID(),
      );
      await this.refresh();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Cambios guardados sin conexión"
            : "Cliente actualizado",
      });
      return result.mode;
    } catch (e) {
      fail(e);
    }
  },
  /** Only a real 404 means "not found"; any other error reaches the page (No se pudo cargar + Reintentar). */
  async getCustomer(id: string): Promise<RemoteCustomer | undefined> {
    try {
      return await getCachedCustomer(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return undefined;
      throw e;
    }
  },
  async getStatement(
    id: string,
  ): Promise<{ statement: DebtStatement; source: "server" | "cache" } | null> {
    try {
      return await getStatementWithOfflineFallback(id);
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
  }): Promise<{ id: string; mode: "online" | "offline" }> {
    const customer = await this.getCustomer(input.customerId);
    if (!customer) throw new Error("customer not found");

    const error = validateInitialDebtAmount(input.amountRaw);
    if (error) throw new Error(error);

    const amount = parseInitialDebtAmount(input.amountRaw);
    try {
      const result = await createInitialDebtWithOfflineFallback(
        { customerId: input.customerId, amount },
        input.requestId ?? crypto.randomUUID(),
      );
      await this.refresh();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Deuda anterior guardada sin conexión"
            : INITIAL_DEBT_TOAST,
      });
      return {
        id: result.mode === "offline" ? result.debtId : result.debt.id,
        mode: result.mode,
      };
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
  const patchCustomer = useCallback(
    (input: { customerId: string; name: string; phone?: string | null }) =>
      customerStore.patchCustomer(input),
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
    patchCustomer,
    recordAbono,
    recordInitialDebt,
    getCustomer: customerStore.getCustomer,
    getStatement: customerStore.getStatement,
    clearToast: customerStore.clearToast,
  };
}
