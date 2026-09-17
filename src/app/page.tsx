"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import {
  metricCaja,
  metricFiadoOutstanding,
  metricVentas,
  productRepository,
} from "@/repositories";
import { isDbEmpty, loadDemoData } from "@/storage/seed";
import { saleRepository } from "@/repositories";

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function InicioPage() {
  const [hoyVendido, setHoyVendido] = useState(0);
  const [porCobrar, setPorCobrar] = useState(0);
  const [stockBajo, setStockBajo] = useState(0);
  const [emptyToday, setEmptyToday] = useState(true);
  const [showDemo, setShowDemo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const sales = await saleRepository.list();
    const today = startOfToday();
    const todays = sales.filter((s) => s.createdAt >= today);
    const vendido = todays.reduce((a, s) => a + s.saleTotal, 0);
    setHoyVendido(vendido);
    setEmptyToday(todays.length === 0);
    setPorCobrar(await metricFiadoOutstanding());
    const low = await productRepository.lowStock();
    setStockBajo(low.length);
    setShowDemo(await isDbEmpty());
    // touch caja/ventas to keep imports honest for domain separation demos
    void metricCaja;
    void metricVentas;
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onLoadDemo() {
    await loadDemoData();
    setToast("Demo cargada");
    await refresh();
    setTimeout(() => setToast(null), 2000);
  }

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Inicio</h1>
        <p className="text-sm text-ink/60">DulceCalle</p>
      </header>

      <section className="grid grid-cols-1 gap-3">
        <SummaryCard label="Hoy vendido" value={formatCop(hoyVendido)} />
        <SummaryCard label="Por cobrar" value={formatCop(porCobrar)} tone="accent" />
        <SummaryCard
          label="Stock bajo"
          value={String(stockBajo)}
          tone={stockBajo > 0 ? "danger" : "ok"}
        />
      </section>

      {emptyToday && (
        <div className="rounded-2xl border border-ink/10 bg-white p-4">
          <p className="text-base font-medium">Aún no hay ventas hoy.</p>
          <p className="mt-1 text-sm text-ink/60">
            Toca + Nueva venta para empezar.
          </p>
        </div>
      )}

      {showDemo && (
        <button
          type="button"
          onClick={() => void onLoadDemo()}
          className="min-h-11 rounded-[14px] bg-primary px-4 text-sm font-semibold text-ink"
        >
          Cargar demo
        </button>
      )}

      {toast && (
        <div className="fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "danger" | "ok";
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent"
      : tone === "danger"
        ? "text-danger"
        : tone === "ok"
          ? "text-ok"
          : "text-ink";

  return (
    <article className="rounded-2xl border border-ink/[0.08] bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </article>
  );
}
