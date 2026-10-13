"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCop, mulCop } from "@/domain/money";
import { newRequestId } from "@/domain/requestId";
import { RETURN_ERRORS, RETURN_TOAST } from "@/domain/sale/returns";
import { useEntityId } from "@/components/shell/entity-route";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { createReturnWithOfflineFallback } from "@/data/pwa/offline-returns";
import { getSaleDetailWithOfflineFallback } from "@/data/pwa/offline-sales";
import type { SaleDetailResult } from "@/data/pwa/offline-sales";
import { getPwaAuthSession } from "@/data/http/session";
import { useProductImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { ActionBar, ACTION_BAR_SPACE, ABOVE_ACTION_BAR } from "@/components/ui/ActionBar";

export default function DevolverVentaPage() {
  const router = useRouter();
  const id = useEntityId();
  const [data, setData] = useState<SaleDetailResult | null>(null);
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const imageMap = useProductImageMap(getPwaAuthSession().businessId);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const row = await getSaleDetailWithOfflineFallback(id);
    setData(row);
    if (row) {
      const next: Record<string, string> = {};
      for (const l of row.lines) next[l.id] = "";
      setQtyByLine(next);
    }
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => {
    if (!data) return [];
    return data.lines
      .map((l) => {
        const raw = qtyByLine[l.id] ?? "";
        const qty = Number.parseInt(raw, 10);
        return { line: l, qty: Number.isInteger(qty) ? qty : 0 };
      })
      .filter((x) => x.qty > 0);
  }, [data, qtyByLine]);

  const previewValue = useMemo(
    () => selected.reduce((s, x) => s + mulCop(x.line.unitPrice, x.qty), 0),
    [selected],
  );

  const canSubmit = selected.length > 0 && selected.every((x) => x.qty <= x.line.remaining);

  function fillAll() {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const l of data.lines) {
      next[l.id] = l.remaining > 0 ? String(l.remaining) : "";
    }
    setQtyByLine(next);
  }

  async function confirm() {
    if (!data || busy) return;
    setError(null);
    if (selected.length === 0) {
      setError(RETURN_ERRORS.empty);
      return;
    }
    for (const x of selected) {
      if (x.qty > x.line.remaining) {
        setError(RETURN_ERRORS.exceeds);
        return;
      }
    }
    setBusy(true);
    try {
      if (!requestIdRef.current) requestIdRef.current = newRequestId("dev");
      const result = await createReturnWithOfflineFallback(
        data.sale.id,
        selected.map((x) => ({ saleLineId: x.line.id, qty: x.qty })),
        requestIdRef.current,
      );
      setToast(
        result.mode === "offline"
          ? "Devolución guardada en este dispositivo · se sincronizará automáticamente."
          : RETURN_TOAST,
      );
      setTimeout(() => {
        navigateOfflineAware(router, `/ventas/${data.sale.id}`);
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al devolver");
      setBusy(false);
    }
  }

  function step(lineId: string, remaining: number, delta: number) {
    setQtyByLine((prev) => {
      const cur = Number.parseInt(prev[lineId] ?? "", 10) || 0;
      const next = Math.min(remaining, Math.max(0, cur + delta));
      return { ...prev, [lineId]: next > 0 ? String(next) : "" };
    });
  }

  if (!ready) {
    return (
      <div className="flex flex-col">
        <SkeletonHero />
        <Sheet>
          <SkeletonRows rows={3} />
        </Sheet>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col">
        <HeroBlock size="compact" back={{ href: "/ventas", label: "Volver a Ventas", entity: true }} title="Devolver">
          <StateBlock kind="empty" onHero title="No encontramos esa venta." />
        </HeroBlock>
      </div>
    );
  }

  const remainingLines = data.lines.filter((l) => l.remaining > 0);

  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock
        size="compact"
        back={{ href: `/ventas/${data.sale.id}`, label: "Volver a la venta", entity: true }}
        title="Devolver"
        subtitle={`Venta ${formatCop(data.sale.saleTotal)}`}
        offline={data.source === "cache" ? { text: "Sin conexión · mostrando venta guardada en este dispositivo." } : null}
      />

      <Sheet>
        {data.returnPending && (
          <p className="rounded-[var(--r-lg)] bg-warning-soft px-3 py-2.5 text-sm text-warning">
            Hay una devolución pendiente. El inventario todavía no cambió.
          </p>
        )}

        {remainingLines.length === 0 ? (
          <StateBlock
            kind="empty"
            title={data.returnPending ? "La devolución está pendiente de confirmación." : "Esta venta ya se devolvió."}
          />
        ) : (
          <>
            <section className="flex flex-col gap-2" aria-label="Cantidades">
              <div className="flex items-baseline justify-between gap-2">
                <SectionHead title="Elige qué vuelve" />
                <button
                  type="button"
                  onClick={fillAll}
                  className="min-h-11 text-xs font-semibold text-ink underline underline-offset-2"
                >
                  Devolver todo
                </button>
              </div>
              <RowGroup>
                {remainingLines.map((l) => {
                  const qty = Number.parseInt(qtyByLine[l.id] ?? "", 10) || 0;
                  return (
                    <Row
                      key={l.id}
                      leading={
                        <ProductThumbnail secureUrl={imageMap.get(l.productId) ?? null} alt={l.productName} size="sm" />
                      }
                      title={l.productName}
                      meta={`Quedan ${l.remaining} · ${formatCop(l.unitPrice)} c/u`}
                      trailing={
                        <span className="flex items-center gap-1" role="group" aria-label={`Cantidad a devolver de ${l.productName}`}>
                          <button
                            type="button"
                            onClick={() => step(l.id, l.remaining, -1)}
                            disabled={qty === 0}
                            aria-label={`Quitar uno de ${l.productName}`}
                            className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-lg font-semibold text-ink disabled:opacity-40"
                          >
                            −
                          </button>
                          <span className="min-w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => step(l.id, l.remaining, 1)}
                            disabled={qty >= l.remaining}
                            aria-label={`Agregar uno de ${l.productName}`}
                            className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-lg font-semibold text-ink disabled:opacity-40"
                          >
                            +
                          </button>
                        </span>
                      }
                    />
                  );
                })}
              </RowGroup>
            </section>

            {previewValue > 0 && (
              <RowGroup>
                <Row
                  title={`Se devuelve ${formatCop(previewValue)}`}
                  meta="El inventario sube cuando el servidor confirme la devolución."
                />
              </RowGroup>
            )}

            {error && <StateBlock kind="error" title={error} />}

            <p className="text-xs text-ink-muted">
              Si la venta fue pagada, sale plata de caja o Nequi. Si fue fiada, baja la deuda. La venta original no se borra.
            </p>
          </>
        )}
      </Sheet>

      {remainingLines.length > 0 && (
        <ActionBar
          primary={{
            label: previewValue > 0 ? `Devolver ${formatCop(previewValue)}` : "Devolver",
            onClick: () => void confirm(),
            disabled: !canSubmit,
            busy,
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className={`fixed ${ABOVE_ACTION_BAR} left-1/2 z-50 max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-center text-sm text-bg`}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
