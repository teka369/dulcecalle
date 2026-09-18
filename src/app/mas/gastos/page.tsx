"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import { CASH_COPY } from "@/domain/cash";
import type { Expense } from "@/domain/types";
import { cashStore } from "@/store/cashStore";

export default function GastosPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [closed, setClosed] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const summary = await cashStore.refresh();
    setExpenses(cashStore.getSnapshot().expenses);
    setClosed(summary.closed);
    setHasSession(summary.session != null);
    setReady(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/mas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">{CASH_COPY.masGastos}</h1>
      </header>

      {closed && (
        <p className="rounded-2xl border border-ink/10 bg-surface p-3 text-sm text-ink/70">
          {CASH_COPY.elDiaEstaCerrado}
        </p>
      )}

      {expenses.length === 0 ? (
        <div className="rounded-2xl border border-ink/10 bg-surface p-4">
          <p className="text-sm text-ink/60">Aún no hay gastos.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {expenses.map((e) => (
            <li
              key={e.id}
              className="rounded-2xl border border-ink/[0.08] bg-surface p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{e.category}</p>
                  <p className="text-xs text-ink/50">{e.method}</p>
                </div>
                <p className="font-semibold text-danger">{formatCop(e.amount)}</p>
              </div>
              {e.note && (
                <p className="mt-1 text-sm text-ink/60">{e.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!closed && hasSession && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <Link
              href="/mas/gastos/nuevo"
              className="flex min-h-11 w-full items-center justify-center rounded-[14px] bg-cta text-sm font-semibold text-white"
            >
              {CASH_COPY.registrarGasto}
            </Link>
          </div>
        </div>
      )}

      {!closed && !hasSession && (
        <p className="text-sm text-ink/60">{CASH_COPY.emptyCerrada}</p>
      )}
    </div>
  );
}
