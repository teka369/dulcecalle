"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useParams, useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCop } from "@/domain/money";
import { newRequestId } from "@/domain/requestId";
import type { PayMethod } from "@/domain/types";
import type { RemoteProduct, RemoteSupplier } from "@/data/http/mappers";
import { validateSurtirForm } from "@/domain/inventory";
import { primaryImageUrl } from "@/data/media/urls";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { routeId } from "@/data/pwa/ids";
import { getPendingSupplierIds } from "@/data/pwa/offline-catalog";
import { inventoryStore } from "@/store/inventoryStore";

export default function SurtirPage() {
  const params = useParams();
  const router = useRouter();
  const id = routeId(params.id);
  const [product, setProduct] = useState<RemoteProduct | null>(null);
  const [suppliers, setSuppliers] = useState<RemoteSupplier[]>([]);
  const [pendingSupplierIds, setPendingSupplierIds] = useState<string[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierCreate, setSupplierCreate] = useState("");
  const [qtyRaw, setQtyRaw] = useState("");
  const [unitCostRaw, setUnitCostRaw] = useState("");
  const [totalCostRaw, setTotalCostRaw] = useState("");
  const [method, setMethod] = useState<PayMethod>("Efectivo");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [totalLocked, setTotalLocked] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const p = await inventoryStore.getProduct(id);
    setProduct(p ?? null);
    const s = await inventoryStore.refreshSuppliers();
    setSuppliers(s);
    void getPendingSupplierIds().then(setPendingSupplierIds);
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
      if (!requestIdRef.current) requestIdRef.current = newRequestId("surtir");
      await inventoryStore.surtir({
        productId: product.id,
        qtyRaw,
        unitCostRaw,
        totalCostRaw,
        method,
        supplierId: supplierId || null,
        supplierNameCreate: supplierCreate,
        note,
        requestId: requestIdRef.current,
      });
      setToast(
        r.totalCost > 0
          ? `Stock actualizado · salieron ${formatCop(r.totalCost)} de ${method}`
          : "Stock actualizado",
      );
      setTimeout(() => {
        navigateOfflineAware(router, `/inventario/${product.id}`);
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al surtir");
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

  if (!product) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/inventario" className="text-sm text-ink-muted">
          ← Inventario
        </Link>
        <p className="text-sm text-ink-muted">No encontramos ese producto.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href={`/inventario/${product.id}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Surtir</h1>
      </header>

      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <ProductThumbnail
            secureUrl={primaryImageUrl(product.images)}
            alt={product.name}
            size="md"
          />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Producto
            </p>
            <p className="mt-1 font-semibold">{product.name}</p>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="proveedor">
            Proveedor
          </label>
          <select
            id="proveedor"
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setSupplierCreate("");
            }}
            className="mt-2 h-11 min-h-11 w-full rounded-[var(--r-md)] border border-border bg-surface px-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">Elegir o crear…</option>
            {suppliers.map((s) =>
              pendingSupplierIds.includes(s.id) ? (
                <option key={s.id} value={s.id} disabled>
                  {s.name} (sincronizando…)
                </option>
              ) : (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ),
            )}
          </select>
          {pendingSupplierIds.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Los proveedores marcados se están sincronizando y estarán
              disponibles en cuanto terminen.
            </p>
          )}
          {supplierId === "" && (
            <Input
              value={supplierCreate}
              onChange={(e) => setSupplierCreate(e.target.value)}
              placeholder="Escribir nombre nuevo"
              className="mt-2"
            />
          )}
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="cantidad">
            Cantidad
          </label>
          <Input
            id="cantidad"
            inputMode="numeric"
            value={qtyRaw}
            onChange={(e) => onQtyChange(e.target.value)}
            className="mt-2"
            placeholder="0"
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="unit-cost">
            Costo unitario
          </label>
          <Input
            id="unit-cost"
            inputMode="numeric"
            value={unitCostRaw}
            onChange={(e) => onUnitChange(e.target.value)}
            className="mt-2"
            placeholder="0"
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="total-cost">
            Costo total
          </label>
          <Input
            id="total-cost"
            inputMode="numeric"
            value={totalCostRaw}
            onChange={(e) => onTotalChange(e.target.value)}
            className="mt-2"
            placeholder="0"
          />
          {previewTotal > 0 && (
            <p className="mt-1 text-sm text-ink-muted">{formatCop(previewTotal)}</p>
          )}
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
          {previewTotal > 0 && (
            <p className="mt-2 text-sm text-ink-muted">
              Sale {formatCop(previewTotal)} de {method}. No es un gasto ni un
              retiro.
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="notas">
            Notas
          </label>
          <Input
            id="notas"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-2"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button
            type="button"
            variant="primary"
            disabled={!valid || busy}
            onClick={() => void confirm()}
            className="w-full"
          >
            {previewTotal > 0
              ? `Confirmar surtir · ${formatCop(previewTotal)}`
              : "Confirmar surtir"}
          </Button>
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
      className={`min-h-11 rounded-[var(--r-md)] border px-2 text-sm font-semibold ${
        active
          ? "border-primary bg-primary text-ink"
          : "border-border bg-surface text-ink-muted"
      }`}
    >
      {label}
    </button>
  );
}
