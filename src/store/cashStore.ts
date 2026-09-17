"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Expense, PayMethod } from "@/domain/types";
import {
  CASH_COPY,
  CASH_ERRORS,
  parseCopAmount,
  validateCashAmount,
  validateCounted,
  validateGasto,
  validateOpeningFloat,
} from "@/domain/cash";
import {
  cashRepository,
  type DayCashSummary as RepoSummary,
} from "@/repositories/cashRepository";

export type { DayCashSummary } from "@/repositories/cashRepository";

type CashState = {
  summary: RepoSummary | null;
  expenses: Expense[];
  loading: boolean;
  lastToast: string | null;
};

const listeners = new Set<() => void>();

let state: CashState = {
  summary: null,
  expenses: [],
  loading: false,
  lastToast: null,
};

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<CashState>) {
  state = { ...state, ...patch };
  emit();
}

export const cashStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): CashState {
    return state;
  },
  async refresh(): Promise<RepoSummary> {
    setState({ loading: true });
    const [summary, expenses] = await Promise.all([
      cashRepository.daySummary(),
      cashRepository.listExpenses(),
    ]);
    setState({ summary, expenses, loading: false });
    return summary;
  },
  async openCaja(openingRaw: string): Promise<void> {
    const err = validateOpeningFloat(openingRaw);
    if (err) throw new Error(err);
    const amount = openingRaw.trim() === "" ? 0 : parseCopAmount(openingRaw)!;
    await cashRepository.openSession(amount);
    setState({ lastToast: CASH_COPY.toastCajaAbierta });
    await this.refresh();
  },
  async recordGasto(input: {
    amountRaw: string;
    categoryRaw: string;
    method: PayMethod | null;
    note?: string;
    requestId?: string;
  }): Promise<void> {
    const err = validateGasto({
      amountRaw: input.amountRaw,
      categoryRaw: input.categoryRaw,
      method: input.method,
    });
    if (err) throw new Error(err);
    const summary = await cashRepository.daySummary();
    if (summary.closed) throw new Error(CASH_ERRORS.dayClosed);
    if (!summary.session) throw new Error(CASH_ERRORS.noOpenSession);
    await cashRepository.recordExpense({
      amount: parseCopAmount(input.amountRaw)!,
      category: input.categoryRaw.trim(),
      method: input.method!,
      note: input.note?.trim() || undefined,
      requestId: input.requestId,
    });
    setState({ lastToast: CASH_COPY.toastGasto });
    await this.refresh();
  },
  async recordRetiro(input: {
    amountRaw: string;
    method: PayMethod | null;
    note?: string;
    requestId?: string;
  }): Promise<void> {
    const err = validateCashAmount({
      amountRaw: input.amountRaw,
      method: input.method,
    });
    if (err) throw new Error(err);
    const summary = await cashRepository.daySummary();
    if (summary.closed) throw new Error(CASH_ERRORS.dayClosed);
    if (!summary.session) throw new Error(CASH_ERRORS.noOpenSession);
    await cashRepository.ownerRetiro(
      parseCopAmount(input.amountRaw)!,
      input.method!,
      input.note?.trim() || undefined,
      input.requestId,
    );
    setState({ lastToast: CASH_COPY.toastRetiro });
    await this.refresh();
  },
  async recordAporte(input: {
    amountRaw: string;
    method: PayMethod | null;
    note?: string;
    requestId?: string;
  }): Promise<void> {
    const err = validateCashAmount({
      amountRaw: input.amountRaw,
      method: input.method,
    });
    if (err) throw new Error(err);
    const summary = await cashRepository.daySummary();
    if (summary.closed) throw new Error(CASH_ERRORS.dayClosed);
    if (!summary.session) throw new Error(CASH_ERRORS.noOpenSession);
    await cashRepository.ownerAporte(
      parseCopAmount(input.amountRaw)!,
      input.method!,
      input.note?.trim() || undefined,
      input.requestId,
    );
    setState({ lastToast: CASH_COPY.toastAporte });
    await this.refresh();
  },
  async closeCaja(countedRaw: string): Promise<void> {
    const err = validateCounted(countedRaw);
    if (err) throw new Error(err);
    const summary = await cashRepository.daySummary();
    if (!summary.session || summary.session.id == null) {
      throw new Error(CASH_ERRORS.noOpenSession);
    }
    if (summary.closed) throw new Error(CASH_ERRORS.sessionAlreadyClosed);
    await cashRepository.closeSession(
      summary.session.id,
      parseCopAmount(countedRaw)!,
    );
    setState({ lastToast: CASH_COPY.toastCajaCerrada });
    await this.refresh();
  },
  clearToast() {
    setState({ lastToast: null });
  },
};

export function useCash() {
  const snap = useSyncExternalStore(
    cashStore.subscribe,
    cashStore.getSnapshot,
    cashStore.getSnapshot,
  );

  const refresh = useCallback(() => cashStore.refresh(), []);

  return {
    ...snap,
    refresh,
    openCaja: cashStore.openCaja.bind(cashStore),
    recordGasto: cashStore.recordGasto.bind(cashStore),
    recordRetiro: cashStore.recordRetiro.bind(cashStore),
    recordAporte: cashStore.recordAporte.bind(cashStore),
    closeCaja: cashStore.closeCaja.bind(cashStore),
    clearToast: cashStore.clearToast,
  };
}
