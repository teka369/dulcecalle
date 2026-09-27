"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCop, mulCop } from "@/domain/money";
import { newRequestId } from "@/domain/requestId";
import { RETURN_ERRORS, RETURN_TOAST } from "@/domain/sale/returns";
import { routeId } from "@/data/pwa/ids";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { createReturnWithOfflineFallback } from "@/data/pwa/offline-returns";
import { getSaleDetailWithOfflineFallback } from "@/data/pwa/offline-sales";
import type { SaleDetailResult } from "@/data/pwa/offline-sales";
import { getPwaAuthSession } from "@/data/http/session";
import { useProductImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

export default function DevolverVentaPage() {
  const params = useParams();
  const router = useRouter();
  const id = routeId(params.id);
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

  if (!ready) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/ventas" className="text-sm text-ink-muted">
          ← Ventas
        </Link>
        <p className="text-sm text-ink-muted">No encontramos esa venta.</p>
      </div>
    );
  }

  const remainingLines = data.lines.filter((l) => l.remaining > 0);

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href={`/ventas/${data.sale.id}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Devolver</h1>
      </header>

      <p className="text-sm text-ink-muted">
        Los productos vuelven al inventario. Si la venta fue pagada, sale plata
        de caja o Nequi. Si fue fiada, baja la deuda. La venta original no se
        borra.
      </p>

      {data.returnPending && (
        <p className="text-xs text-ink-muted">
          Hay una devolución pendiente. El inventario todavía no cambió.
        </p>
      )}

      {remainingLines.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {data.returnPending
            ? "La devolución está pendiente de confirmación."
            : "Esta venta ya se devolvió."}
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            {remainingLines.map((l) => (
              <Card key={l.id}>
                <div className="flex items-start gap-2">
                  <ProductThumbnail
                    secureUrl={imageMap.get(l.productId) ?? null}
                    alt={l.productName}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.productName}</p>
                    <p className="text-sm text-ink-muted">
                      Quedan {l.remaining} · {formatCop(l.unitPrice)} c/u
                    </p>
                  </div>
                </div>
                <label
                  className="mt-3 block text-sm font-medium"
                  htmlFor={`qty-${l.id}`}
                >
                  Cantidad a devolver
                </label>
                <Input
                  id={`qty-${l.id}`}
                  inputMode="numeric"
                  value={qtyByLine[l.id] ?? ""}
                  onChange={(e) =>
                    setQtyByLine((prev) => ({
                      ...prev,
                      [l.id]: e.target.value.replace(/\D/g, ""),
                    }))
                  }
                  className="mt-2"
                  placeholder="0"
                />
              </Card>
            ))}
          </section>

          <Button type="button" variant="secondary" onClick={fillAll} className="w-full">
            Devolver todo
          </Button>

          {previewValue > 0 && (
            <p className="text-sm text-ink-muted">
              Se ajustan {formatCop(previewValue)}. El inventario sube cuando el servidor confirme la devolución.
            </p>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </>
      )}

      {remainingLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <Button
              type="button"
              variant="primary"
              disabled={!canSubmit || busy}
              onClick={() => void confirm()}
              className="w-full"
            >
              Confirmar devolución
            </Button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
