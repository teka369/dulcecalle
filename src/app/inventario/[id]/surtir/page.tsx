"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCop } from "@/domain/money";
import type { PayMethod, Product, Supplier } from "@/domain/types";
import { validateSurtirForm } from "@/domain/inventory";
import { inventoryStore } from "@/store/inventoryStore";

export default function SurtirPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [product, setProduct] = useState<Product | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [supplierCreate, setSupplierCreate] = useState("");
  const [qtyRaw, setQtyRaw] = useState("");
  const [unitCostRaw, setUnitCostRaw] = useState("");
  const [totalCostRaw, setTotalCostRaw] = useState("");
  const [dateRaw, setDateRaw] = useState(inventoryStore.todayLocalDateInput());
  const [method, setMethod] = useState<PayMethod>("Efectivo");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [totalLocked, setTotalLocked] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setReady(true);
      return;
    }
    const p = await inventoryStore.getProduct(id);
    setProduct(p ?? null);
    const s = await inventoryStore.refreshSuppliers();
    setSuppliers(s);
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function onQtyChange(raw: string) {
    const digits = raw.replace(/\D/g, "");
    setQtyRaw(digits);
    const qty = Number.parseInt(digits, 10);
    if (!Number.isInteger(qty) || qty <= 0) return;
    if (totalLocked) {
      const total = Number.parseInt(totalCostRaw, 10);
      if (Number.isInteger(total) && total >= 0) {
        setUnitCostRaw(String(Math.round(total / qty)));
      }
    } else {
      const unit = Number.parseInt(unitCostRaw, 10);
      if (Number.isInteger(unit) && unit >= 0) {
        setTotalCostRaw(String(unit * qty));
      }
    }
  }

  function onUnitChange(raw: string) {
    const digits = raw.replace(/\D/g, "");
    setTotalLocked(false);
    setUnitCostRaw(digits);
    const qty = Number.parseInt(qtyRaw, 10);
    const unit = Number.parseInt(digits, 10);
    if (Number.isInteger(qty) && qty > 0 && Number.isInteger(unit) && unit >= 0) {
      setTotalCostRaw(String(unit * qty));
    }
  }

  function onTotalChange(raw: string) {
    const digits = raw.replace(/\D/g, "");
    setTotalLocked(true);
    setTotalCostRaw(digits);
    const qty = Number.parseInt(qtyRaw, 10);
    const total = Number.parseInt(digits, 10);
    if (Number.isInteger(qty) && qty > 0 && Number.isInteger(total) && total >= 0) {
      setUnitCostRaw(String(Math.round(total / qty)));
    }
  }

  const previewTotal = useMemo(() => {
    const n = Number.parseInt(totalCostRaw || "0", 10);
    return Number.isFinite(n) ? n : 0;
  }, [totalCostRaw]);

  const valid = useMemo(() => {
    const r = validateSurtirForm({
      qtyRaw,
      unitCostRaw,
      totalCostRaw,
      method,
    });
    return !("error" in r);
  }, [qtyRaw, unitCostRaw, totalCostRaw, method]);

  async function confirm() {
    if (!product || busy) return;
    setError(null);
    const r = validateSurtirForm({
      qtyRaw,
      unitCostRaw,
      totalCostRaw,
      method,
    });
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setBusy(true);
    try {
      await inventoryStore.surtir({
        productId: product.id!,
        qtyRaw,
        unitCostRaw,
        totalCostRaw,
        method,
        supplierId: supplierId === "" ? null : Number(supplierId),
        supplierNameCreate: supplierCreate,
        note,
        dateRaw,
      });
      setToast("Stock actualizado");
      setTimeout(() => {
        router.push(`/inventario/${product.id}`);
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al surtir");
      setBusy(false);
    }
  }

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!product) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/inventario" className="text-sm text-ink/70">
          ← Inventario
        </Link>
        <p className="text-sm text-ink/60">No encontramos ese producto.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href={`/inventario/${product.id}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Surtir</h1>
      </header>

      <section className="flex flex-col gap-4 rounded-2xl border border-ink/[0.08] bg-white p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
            Producto
          </p>
          <p className="mt-1 font-semibold">{product.name}</p>
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="proveedor">
            Proveedor
          </label>
          <select
            id="proveedor"
            value={supplierId === "" ? "" : String(supplierId)}
            onChange={(e) => {
              setSupplierId(e.target.value ? Number(e.target.value) : "");
              setSupplierCreate("");
            }}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 bg-white px-3 text-base outline-none focus:border-primary"
          >
            <option value="">Elegir o crear…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {supplierId === "" && (
            <input
              value={supplierCreate}
              onChange={(e) => setSupplierCreate(e.target.value)}
              placeholder="Escribir nombre nuevo"
              className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
            />
          )}
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="cantidad">
            Cantidad
          </label>
          <input
            id="cantidad"
            inputMode="numeric"
            value={qtyRaw}
            onChange={(e) => onQtyChange(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
            placeholder="0"
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="unit-cost">
            Costo unitario
          </label>
          <input
            id="unit-cost"
            inputMode="numeric"
            value={unitCostRaw}
            onChange={(e) => onUnitChange(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
            placeholder="0"
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="total-cost">
            Costo total
          </label>
          <input
            id="total-cost"
            inputMode="numeric"
            value={totalCostRaw}
            onChange={(e) => onTotalChange(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
            placeholder="0"
          />
          {previewTotal > 0 && (
            <p className="mt-1 text-sm text-ink/60">{formatCop(previewTotal)}</p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="fecha">
            Fecha
          </label>
          <input
            id="fecha"
            type="date"
            value={dateRaw}
            onChange={(e) => setDateRaw(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
        </div>

        <div>
          <p className="text-sm font-semibold">¿Cómo pagaste?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <MethodButton
              label="Efectivo"
              active={method === "Efectivo"}
              onClick={() => setMethod("Efectivo")}
            />
            <MethodButton
              label="Nequi"
              active={method === "Nequi"}
              onClick={() => setMethod("Nequi")}
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="notas">
            Notas
          </label>
          <input
            id="notas"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void confirm()}
            className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            Confirmar surtir
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

function MethodButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-[14px] border px-2 text-sm font-semibold ${
        active
          ? "border-primary bg-primary text-ink"
          : "border-ink/10 bg-white text-ink/70"
      }`}
    >
      {label}
    </button>
  );
}
