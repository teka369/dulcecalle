"use client";

import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCop, mulCop, addCop, subCop } from "@/domain/money";
import type { PaymentKind } from "@/domain/types";
import type { RemoteCustomer, RemoteProduct } from "@/data/http/mappers";
import { createSaleWithOfflineFallback } from "@/data/pwa/offline-sales";
import { primaryImageUrl } from "@/data/media/urls";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { getPendingCustomerIds } from "@/data/pwa/offline-catalog";
import { listCachedCustomers, listCachedProducts } from "@/data/pwa/catalog";
import { useCart } from "@/store/cartStore";

export default function CobrarPage() {
  const router = useRouter();
  const {
    items,
    hydrated,
    paymentKind,
    customerId,
    amountReceived,
    method,
    setPaymentKind,
    setCustomerId,
    setAmountReceived,
    setMethod,
    clear,
  } = useCart();
  const [products, setProducts] = useState<RemoteProduct[]>([]);
  const [customers, setCustomers] = useState<RemoteCustomer[]>([]);
  const [pendingCustomerIds, setPendingCustomerIds] = useState<string[]>([]);
  const [abonoInput, setAbonoInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    void listCachedProducts()
      .then(setProducts)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Sin conexión.");
      });
    void listCachedCustomers()
      .then(setCustomers)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Sin conexión.");
      });
    void getPendingCustomerIds().then(setPendingCustomerIds);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (items.length === 0) {
      navigateOfflineAware(router, "/ventas/nueva", { replace: true });
    }
  }, [hydrated, items.length, router]);

  const lines = useMemo(() => {
    return items
      .map((item) => {
        const p = products.find((x) => x.id === item.productId);
        if (!p) return null;
        const unitPrice = item.unitPrice ?? p.price;
        return {
          productId: p.id,
          name: p.name,
          imageUrl: primaryImageUrl(p.images),
          qty: item.qty,
          unitPrice,
          catalogPrice: p.price,
          lineTotal: mulCop(unitPrice, item.qty),
        };
      })
      .filter(Boolean) as Array<{
      productId: string;
      name: string;
      imageUrl: string | null;
      qty: number;
      unitPrice: number;
      catalogPrice: number;
      lineTotal: number;
    }>;
  }, [items, products]);

  const total = useMemo(
    () => lines.reduce((s, l) => addCop(s, l.lineTotal), 0),
    [lines],
  );

  const abono =
    paymentKind === "partial"
      ? Number.parseInt(abonoInput || "0", 10) || 0
      : paymentKind === "paid"
        ? total
        : 0;

  const quedaDebiendo =
    paymentKind === "partial" && abono > 0 && abono < total
      ? subCop(total, abono)
      : paymentKind === "credit"
        ? total
        : 0;

  const valid = useMemo(() => {
    if (total <= 0 || lines.length === 0) return false;
    if (paymentKind === "paid") return true;
    if (paymentKind === "partial") {
      return abono > 0 && abono < total && customerId != null;
    }
    if (paymentKind === "credit") {
      return customerId != null;
    }
    return false;
  }, [total, lines.length, paymentKind, abono, customerId]);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const received =
        paymentKind === "paid"
          ? total
          : paymentKind === "partial"
            ? abono
            : 0;

      if (!requestIdRef.current) {
        requestIdRef.current = crypto.randomUUID();
      }

      const result = await createSaleWithOfflineFallback(
        {
          lines: lines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            unitPrice: l.unitPrice,
          })),
          paymentKind,
          customerId:
            paymentKind === "paid" ? undefined : (customerId ?? undefined),
          amountReceived: received,
          method: received > 0 ? method : undefined,
        },
        requestIdRef.current,
      );

      clear();
      setToast(
        result.mode === "offline"
          ? "Venta guardada en este dispositivo · se sincronizará automáticamente."
          : "Venta registrada",
      );
      setTimeout(() => {
        navigateOfflineAware(router, "/");
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al registrar venta");
      setBusy(false);
    }
  }

  function selectKind(kind: PaymentKind) {
    setPaymentKind(kind);
    setAmountReceived(kind === "credit" ? 0 : null);
    if (kind === "paid") setCustomerId(null);
    if (kind !== "partial") setAbonoInput("");
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/ventas/nueva"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Cobrar</h1>
      </header>

      <Card>
        <h2 className="text-sm font-semibold text-ink-muted">Resumen</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {lines.map((l) => (
            <li key={l.productId} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <ProductThumbnail secureUrl={l.imageUrl} alt={l.name} size="xs" />
                <span className="min-w-0">
                  {l.name} ×{l.qty}
                  {l.unitPrice !== l.catalogPrice && (
                    <span className="ml-1 text-ink-muted">
                      ({formatCop(l.unitPrice)})
                    </span>
                  )}
                </span>
              </span>
              <span className="shrink-0 font-medium">{formatCop(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-border pt-3 text-base font-semibold">
          <span>Total</span>
          <span>{formatCop(total)}</span>
        </div>
      </Card>

      <section>
        <h2 className="mb-2 text-base font-semibold">¿Cómo pagan?</h2>
        <div className="grid grid-cols-3 gap-2">
          <ModeButton
            label="Pagada"
            active={paymentKind === "paid"}
            color="ok"
            onClick={() => selectKind("paid")}
          />
          <ModeButton
            label="Parcial"
            active={paymentKind === "partial"}
            color="primary"
            onClick={() => selectKind("partial")}
          />
          <ModeButton
            label="Fiada"
            active={paymentKind === "credit"}
            color="accent"
            onClick={() => selectKind("credit")}
          />
        </div>
      </section>

      {paymentKind !== "credit" && (
        <Card>
          <p className="text-sm font-semibold">¿Cómo recibes?</p>
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
        </Card>
      )}

      {paymentKind === "partial" && (
        <Card>
          <label className="text-sm font-medium" htmlFor="abono">
            Abono
          </label>
          <Input
            id="abono"
            inputMode="numeric"
            value={abonoInput}
            onChange={(e) =>
              setAbonoInput(e.target.value.replace(/\D/g, ""))
            }
            className="mt-2"
            placeholder="0"
          />
          {abono > 0 && abono < total && (
            <p className="mt-2 text-sm text-ink-muted">
              Queda debiendo {formatCop(quedaDebiendo)}
            </p>
          )}
          <CustomerPicker
            customers={customers}
            customerId={customerId}
            pendingIds={pendingCustomerIds}
            onChange={setCustomerId}
          />
        </Card>
      )}

      {paymentKind === "credit" && (
        <Card>
          <CustomerPicker
            customers={customers}
            customerId={customerId}
            pendingIds={pendingCustomerIds}
            onChange={setCustomerId}
          />
        </Card>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button
            type="button"
            variant="primary"
            disabled={!valid || busy}
            onClick={() => void confirm()}
            className="w-full"
          >
            Confirmar venta
          </Button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}

      <span className="hidden">{amountReceived}</span>
    </div>
  );
}

function ModeButton({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: "ok" | "primary" | "accent";
  onClick: () => void;
}) {
  const activeClass =
    color === "ok"
      ? "border-ok bg-ok text-white hover:opacity-[0.92]"
      : color === "primary"
        ? "border-primary bg-primary text-ink hover:opacity-[0.92]"
        : "border-accent bg-accent text-white hover:opacity-[0.92]";

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      className={`w-full px-2 ${active ? activeClass : "text-ink-muted"}`}
    >
      {label}
    </Button>
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
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      className={`w-full px-2 ${
        active
          ? "border-primary bg-primary text-ink hover:opacity-[0.92]"
          : "text-ink-muted"
      }`}
    >
      {label}
    </Button>
  );
}

function CustomerPicker({
  customers,
  customerId,
  pendingIds,
  onChange,
}: {
  customers: RemoteCustomer[];
  customerId: string | null;
  pendingIds: string[];
  onChange: (id: string | null) => void;
}) {
  const pending = new Set(pendingIds);
  return (
    <div className="mt-3">
      <label className="text-sm font-medium" htmlFor="cliente">
        Cliente
      </label>
      <select
        id="cliente"
        className="mt-2 h-11 min-h-11 w-full rounded-[var(--r-md)] border border-border bg-surface px-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
        value={customerId ?? ""}
        onChange={(e) => onChange(e.target.value ? e.target.value : null)}
      >
        <option value="">Selecciona cliente</option>
        {customers.map((c) =>
          pending.has(c.id) ? (
            <option key={c.id} value={c.id} disabled>
              {c.name} (sincronizando…)
            </option>
          ) : (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ),
        )}
      </select>
      {pendingIds.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          Los clientes marcados se están sincronizando y estarán disponibles
          en cuanto terminen.
        </p>
      )}
    </div>
  );
}
