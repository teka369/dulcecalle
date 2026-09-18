"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCop, mulCop } from "@/domain/money";
import { newRequestId } from "@/domain/requestId";
import { RETURN_ERRORS, RETURN_TOAST } from "@/domain/sale/returns";
import { saleRepository } from "@/repositories";

type Returnable = NonNullable<
  Awaited<ReturnType<typeof saleRepository.getReturnable>>
>;

export default function DevolverVentaPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [data, setData] = useState<Returnable | null>(null);
  const [qtyByLine, setQtyByLine] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setReady(true);
      return;
    }
    const row = await saleRepository.getReturnable(id);
    setData(row ?? null);
    if (row) {
      const next: Record<number, string> = {};
      for (const l of row.lines) next[l.id!] = "";
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
        const raw = qtyByLine[l.id!] ?? "";
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
    const next: Record<number, string> = {};
    for (const l of data.lines) {
      next[l.id!] = l.remaining > 0 ? String(l.remaining) : "";
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
      await saleRepository.createReturn({
        saleId: data.sale.id!,
        lines: selected.map((x) => ({ saleLineId: x.line.id!, qty: x.qty })),
        requestId: requestIdRef.current,
      });
      setToast(RETURN_TOAST);
      setTimeout(() => {
        router.push(`/ventas/${data.sale.id}`);
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al devolver");
      setBusy(false);
    }
  }

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/ventas" className="text-sm text-ink/70">
          ← Ventas
        </Link>
        <p className="text-sm text-ink/60">No encontramos esa venta.</p>
      </div>
    );
  }

  const remainingLines = data.lines.filter((l) => l.remaining > 0);

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href={`/ventas/${data.sale.id}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Devolver</h1>
      </header>

      <p className="text-sm text-ink/70">
        Los productos vuelven al inventario. Si la venta fue pagada, sale plata
        de caja o Nequi. Si fue fiada, baja la deuda. La venta original no se
        borra.
      </p>

      {remainingLines.length === 0 ? (
        <p className="text-sm text-ink/60">Esta venta ya se devolvió.</p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            {remainingLines.map((l) => (
              <div
                key={l.id}
                className="rounded-2xl border border-ink/[0.08] bg-surface p-4"
              >
                <p className="font-medium">{l.productName}</p>
                <p className="text-sm text-ink/60">
                  Quedan {l.remaining} · {formatCop(l.unitPrice)} c/u
                </p>
                <label
                  className="mt-3 block text-sm font-medium"
                  htmlFor={`qty-${l.id}`}
                >
                  Cantidad a devolver
                </label>
                <input
                  id={`qty-${l.id}`}
                  inputMode="numeric"
                  value={qtyByLine[l.id!] ?? ""}
                  onChange={(e) =>
                    setQtyByLine((prev) => ({
                      ...prev,
                      [l.id!]: e.target.value.replace(/\D/g, ""),
                    }))
                  }
                  className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
                  placeholder="0"
                />
              </div>
            ))}
          </section>

          <button
            type="button"
            onClick={fillAll}
            className="min-h-11 rounded-[14px] border border-ink/10 bg-surface text-sm font-semibold"
          >
            Devolver todo
          </button>

          {previewValue > 0 && (
            <p className="text-sm text-ink/70">
              Se ajustan {formatCop(previewValue)}. El inventario sube con esas
              unidades.
            </p>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </>
      )}

      {remainingLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <button
              type="button"
              disabled={!canSubmit || busy}
              onClick={() => void confirm()}
              className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
            >
              Confirmar devolución
            </button>
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
