"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { PayMethod } from "@/domain/types";
import {
  CASH_COPY,
  CASH_ERRORS,
  parseCopAmount,
  validateCashAmount,
  validateCounted,
  validateGasto,
  validateOpeningFloat,
} from "@/domain/cash";
import { ApiError, NetworkError } from "@/data/errors";
import { getLocalCashSnapshot, openCashWithOfflineFallback, closeCashWithOfflineFallback, recordAporteOffline, recordRetiroOffline, recordExpenseWithOfflineFallback } from "@/data/pwa/offline-operations";
import { getPwaApi } from "@/data/pwa/api";
import type { RemoteExpense, RemoteToday } from "@/data/http/mappers";
import { addCop } from "@/domain/money";

export type DayCashSummary = RemoteToday & {
  counted: number | null;
  difference: number | null;
  entradas: number;
  salidas: number;
};

function toSummary(today: RemoteToday): DayCashSummary {
  let entradas = 0;
  let salidas = 0;
  for (const m of today.moves) {
    if (m.direction === "in") entradas = addCop(entradas, m.amount);
    else salidas = addCop(salidas, m.amount);
  }
  return {
    ...today,
    counted: today.session?.closingCount ?? null,
    difference: today.session?.difference ?? null,
    entradas,
    salidas,
  };
}

type CashState = {
  summary: DayCashSummary | null;
  expenses: RemoteExpense[];
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

function fail(e: unknown): never {
  if (e instanceof ApiError) throw new Error(e.message);
  if (e instanceof Error) throw e;
  throw new Error("Algo salió mal.");
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
  async refresh(): Promise<DayCashSummary> {
    setState({ loading: true });
    try {
      const api = getPwaApi();
      const [today, expenses] = await Promise.all([api.cash.today(), api.cash.expenses()]);
      const summary = toSummary(today);
      setState({ summary, expenses, loading: false });
      return summary;
    } catch (e) {
      if (e instanceof NetworkError) {
        try {
          const local = await getLocalCashSnapshot();
          setState({ summary: local.summary, expenses: local.expenses, loading: false });
          return local.summary;
        } catch (localError) {
          setState({ loading: false });
          fail(localError);
        }
      }
      setState({ loading: false });
      fail(e);
    }
  },
  async openCaja(openingRaw: string): Promise<void> {
    const err = validateOpeningFloat(openingRaw);
    if (err) throw new Error(err);
    const amount = openingRaw.trim() === "" ? 0 : parseCopAmount(openingRaw)!;
    try {
      const result = await openCashWithOfflineFallback(amount, crypto.randomUUID());
      setState({ lastToast: result.mode === "offline" ? "Caja guardada sin conexión" : CASH_COPY.toastCajaAbierta });
      await this.refresh();
    } catch (e) {
      fail(e);
    }
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
    const summary = await this.refresh();
    if (summary.closed) throw new Error(CASH_ERRORS.dayClosed);
    try {
      const result = await recordExpenseWithOfflineFallback(
        { amount: parseCopAmount(input.amountRaw)!, category: input.categoryRaw.trim(), method: input.method!, note: input.note?.trim() || undefined },
        input.requestId ?? crypto.randomUUID(),
      );
      setState({ lastToast: result.mode === "offline" ? "Gasto guardado sin conexión" : CASH_COPY.toastGasto });
      await this.refresh();
    } catch (e) {
      fail(e);
    }
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
    const summary = await this.refresh();
    if (summary.closed) throw new Error(CASH_ERRORS.dayClosed);
    try {
      const result = await recordRetiroOffline(
        { amount: parseCopAmount(input.amountRaw)!, method: input.method!, note: input.note?.trim() || undefined },
        input.requestId ?? crypto.randomUUID(),
      );
      setState({ lastToast: result.mode === "offline" ? "Retiro guardado sin conexión" : CASH_COPY.toastRetiro });
      await this.refresh();
    } catch (e) {
      fail(e);
    }
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
    const summary = await this.refresh();
    if (summary.closed) throw new Error(CASH_ERRORS.dayClosed);
    try {
      const result = await recordAporteOffline(
        { amount: parseCopAmount(input.amountRaw)!, method: input.method!, note: input.note?.trim() || undefined },
        input.requestId ?? crypto.randomUUID(),
      );
      setState({ lastToast: result.mode === "offline" ? "Aporte guardado sin conexión" : CASH_COPY.toastAporte });
      await this.refresh();
    } catch (e) {
      fail(e);
    }
  },
  async closeCaja(countedRaw: string): Promise<void> {
    const err = validateCounted(countedRaw);
    if (err) throw new Error(err);
    const summary = await this.refresh();
    if (!summary.session) throw new Error(CASH_ERRORS.noOpenSession);
    if (summary.closed) throw new Error(CASH_ERRORS.sessionAlreadyClosed);
    try {
      const result = await closeCashWithOfflineFallback(summary.session.id, parseCopAmount(countedRaw)!, crypto.randomUUID());
      setState({ lastToast: result.mode === "offline" ? "Caja cerrada sin conexión" : CASH_COPY.toastCajaCerrada });
      await this.refresh();
    } catch (e) {
      fail(e);
    }
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
