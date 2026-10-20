"use client";

import { useOfflineBand, useOnline } from "@/components/shell/use-online";
import { Input } from "@/components/ui/Input";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { AmountField, amountInputInvalid } from "@/components/ui/AmountField";
import { ChoiceSegmented } from "@/components/ui/ChoiceSegmented";
import { Row } from "@/components/ui/Row";
import { RowGroup } from "@/components/ui/RowGroup";
import { StateBlock } from "@/components/ui/StateBlock";
import { ListErrorState } from "@/components/ui/ListErrorState";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { ActionToast } from "@/components/ui/ActionToast";
import { QtyStepper } from "@/components/inventory/QtyStepper";
import { stockAfter, units } from "@/components/inventory/inventory";
import { ABONO_METHODS } from "@/components/customers/clientes";
import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCop } from "@/domain/money";
import { newRequestId } from "@/domain/requestId";
import type { PayMethod } from "@/domain/types";
import type { RemoteProduct, RemoteSupplier } from "@/data/http/mappers";
import { validateSurtirForm } from "@/domain/inventory";
import { primaryImageUrl } from "@/data/media/urls";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { useEntityId } from "@/components/shell/entity-route";
import { getPendingSupplierIds } from "@/data/pwa/offline-catalog";
import { inventoryStore } from "@/store/inventoryStore";

export default function SurtirPage() {
  const offlineBand = useOfflineBand();
  const router = useRouter();
  const id = useEntityId();
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const online = useOnline();
  const [totalLocked, setTotalLocked] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    setLoadError(null);
    try {
      // Only a real 404 comes back as undefined («No encontramos»); other errors → Reintentar.
      const p = await inventoryStore.getProduct(id);
      setProduct(p ?? null);
      const s = await inventoryStore.refreshSuppliers();
      setSuppliers(s);
      void getPendingSupplierIds().then(setPendingSupplierIds);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "");
    } finally {
      setReady(true);
    }
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
    if (amountInputInvalid()) return; // a rejected amount is on screen: never send
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
    // Offline with a new inline supplier: the store queues supplier:create and the
    // surtir behind it (dependsOn); the stable requestId keeps retries idempotent.
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
      <div className="flex flex-col gap-4">
        <SkeletonHero title="Surtir" />
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div className="flex flex-col">
        <HeroBlock offline={offlineBand} size="compact" back={{ href: "/inventario", label: "Volver a Inventario", entity: true }} title="Surtir" />
        <Sheet>
          <ListErrorState
            message={loadError}
            online={online}
            onRetry={() => {
              setReady(false);
              void load();
            }}
          />
        </Sheet>
      </div>
    );
  }

  if (!product) {
    return (
      <HeroBlock offline={offlineBand} size="compact" back={{ href: "/inventario", label: "Volver a Inventario", entity: true }} title="Surtir">
        <StateBlock onHero kind="empty" title="No encontramos ese producto." />
      </HeroBlock>
    );
  }

  const after = stockAfter(product.stock, qtyRaw, 1);
  const label = "text-xs font-semibold uppercase tracking-wide text-ink-muted";

  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock offline={offlineBand}
        size="compact"
        back={{ href: `/inventario/${product.id}`, label: "Volver al producto", entity: true }}
        title="Surtir"
      >
        <div className="mt-3 flex items-center gap-3">
          <ProductThumbnail secureUrl={primaryImageUrl(product.images)} alt={product.name} size="sm" decorative />
          <p className="min-w-0 text-sm text-on-hero-muted">
            <span className="font-semibold text-on-hero">{product.name}</span> · Stock {units(product.stock)}
          </p>
        </div>
      </HeroBlock>

      <Sheet>
        {error ? <StateBlock kind="error" title={error} /> : null}
        <QtyStepper label="Cantidad" value={qtyRaw} onChange={onQtyChange} />

        <AmountField
          label="Costo total"
          value={totalCostRaw}
          onChange={onTotalChange}
          hint={unitCostRaw ? `Costo unitario ${formatCop(Number.parseInt(unitCostRaw, 10) || 0)}` : undefined}
        />
        <div>
          <label className={label} htmlFor="unit-cost">
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

        <div className="flex flex-col gap-2">
          <p className={label}>¿Cómo pagaste?</p>
          <ChoiceSegmented label="¿Cómo pagaste?" options={ABONO_METHODS} value={method} onChange={setMethod} />
          {previewTotal > 0 && (
            <p className="text-sm text-ink-muted">
              Sale {formatCop(previewTotal)} de {method}. No es un gasto ni un retiro.
            </p>
          )}
        </div>

        <div>
          <label className={label} htmlFor="proveedor">
            Proveedor
          </label>
          <select
            id="proveedor"
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setSupplierCreate("");
            }}
            className="mt-2 h-14 w-full rounded-[var(--r-md)] border border-border bg-surface px-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--cta)]"
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
              Los proveedores marcados se están sincronizando y estarán disponibles en cuanto terminen.
            </p>
          )}
          {supplierId === "" && (
            <Input
              value={supplierCreate}
              onChange={(e) => setSupplierCreate(e.target.value)}
              placeholder="Escribir nombre nuevo"
              aria-label="Nombre de proveedor nuevo"
              className="mt-2"
            />
          )}
        </div>

        <div>
          <label className={label} htmlFor="notas">
            Nota
          </label>
          <Input id="notas" value={note} onChange={(e) => setNote(e.target.value)} className="mt-2" />
        </div>

        {after != null ? (
          <RowGroup label="Resultado">
            <Row title={`Quedará ${units(after)}`} />
          </RowGroup>
        ) : null}

      </Sheet>

      <ActionBar
        summary={previewTotal > 0 ? formatCop(previewTotal) : undefined}
        primary={{ label: "Confirmar surtir", onClick: () => void confirm(), disabled: !valid, busy }}
      />
      <ActionToast text={toast} />
    </div>
  );
}
