"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Customer, PayMethod } from "@/domain/types";
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
import {
  customerRepository,
  type CustomerHistoryItem,
} from "@/repositories/customerRepository";
import type { DebtStatement } from "@/domain/debt/statement";

type CustomerState = {
  customers: Customer[];
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
  async refresh(): Promise<Customer[]> {
    setState({ loading: true });
    const customers = await customerRepository.list();
    setState({ customers, loading: false });
    return customers;
  },
  async createCustomer(name: string): Promise<number> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error(CUSTOMER_ERRORS.emptyName);
    const id = await customerRepository.create({ name: trimmed });
    await this.refresh();
    setState({ lastToast: "Cliente guardado" });
    return id;
  },
  async getCustomer(id: number): Promise<Customer | undefined> {
    return customerRepository.getById(id);
  },
  async getHistory(id: number): Promise<CustomerHistoryItem[]> {
    return customerRepository.listHistory(id);
  },
  async getStatement(id: number): Promise<DebtStatement | null> {
    return customerRepository.getStatement(id);
  },
  /**
   * UI → store → repository → Dexie abono.
   * Validates with exact S2 copy errors before persistence.
   */
  async recordAbono(input: {
    customerId: number;
    amountRaw: string;
    method: PayMethod | null;
    requestId?: string;
  }): Promise<number> {
    const customer = await customerRepository.getById(input.customerId);
    if (!customer) throw new Error("customer not found");

    const error = validateAbono({
      amountRaw: input.amountRaw,
      debt: customer.debt,
      method: input.method,
    });
    if (error) throw new Error(error);

    const amount = parseAbonoAmount(input.amountRaw);
    const paymentId = await customerRepository.recordPayment({
      customerId: input.customerId,
      amount,
      method: input.method as PayMethod,
      requestId: input.requestId,
    });
    await this.refresh();
    setState({ lastToast: "Abono registrado" });
    return paymentId;
  },
  /**
   * UI → store → repository → Dexie deuda anterior.
   * Not a sale. Idempotent via requestId.
   */
  async recordInitialDebt(input: {
    customerId: number;
    amountRaw: string;
    requestId?: string;
  }): Promise<number> {
    const customer = await customerRepository.getById(input.customerId);
    if (!customer) throw new Error("customer not found");

    const error = validateInitialDebtAmount(input.amountRaw);
    if (error) throw new Error(error);

    const amount = parseInitialDebtAmount(input.amountRaw);
    const id = await customerRepository.recordInitialDebt({
      customerId: input.customerId,
      amount,
      requestId: input.requestId,
    });
    await this.refresh();
    setState({ lastToast: INITIAL_DEBT_TOAST });
    return id;
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
      customerId: number;
      amountRaw: string;
      method: PayMethod | null;
      requestId?: string;
    }) => customerStore.recordAbono(input),
    [],
  );
  const recordInitialDebt = useCallback(
    (input: {
      customerId: number;
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
    getHistory: customerStore.getHistory,
    getStatement: customerStore.getStatement,
    clearToast: customerStore.clearToast,
  };
}
