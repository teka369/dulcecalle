"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { formatCop, mulCop } from "@/domain/money";
import type { PayMethod, PaymentKind } from "@/domain/types";
import type { RemoteCustomer, RemoteProduct } from "@/data/http/mappers";
import { createSaleWithOfflineFallback } from "@/data/pwa/offline-sales";
import { primaryImageUrl } from "@/data/media/urls";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { getPendingCustomerIds } from "@/data/pwa/offline-catalog";
import { listCachedCustomers, listCachedProducts } from "@/data/pwa/catalog";
import { useCart } from "@/store/cartStore";
import { CustomerPicker } from "@/components/customers/CustomerPicker";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { ChoiceSegmented } from "@/components/ui/ChoiceSegmented";
import { AmountField } from "@/components/ui/AmountField";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { StateBlock } from "@/components/ui/StateBlock";
import {
  buildSaleRequest,
  canRegister,
  checkoutReducer,
  fiadoFor,
  linesTotal,
  showsMethod,
  type CheckoutAction,
  type CheckoutState,
} from "@/components/sale/checkout";

const KIND_OPTIONS: ReadonlyArray<{ id: PaymentKind; label: string }> = [
  { id: "paid", label: "Pagada" },
  { id: "partial", label: "Parcial" },
  { id: "credit", label: "Fiada" },
];
const METHOD_OPTIONS: ReadonlyArray<{ id: PayMethod; label: string }> = [
  { id: "Efectivo", label: "Efectivo" },
  { id: "Nequi", label: "Nequi" },
];
const KIND_LABEL: Record<PaymentKind, string> = { paid: "Pagada", partial: "Parcial", credit: "Fiada" };

export default function CobrarPage() {
  const router = useRouter();
  const {
    items,
    hydrated,
    paymentKind,
    customerId,
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
  const [note, setNote] = useState("");
  const [showLines, setShowLines] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    void listCachedProducts()
      .then(setProducts)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Sin conexión."));
    void listCachedCustomers()
      .then(setCustomers)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Sin conexión."));
    void getPendingCustomerIds().then(setPendingCustomerIds);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (items.length === 0) navigateOfflineAware(router, "/ventas/nueva", { replace: true });
  }, [hydrated, items.length, router]);

  const lines = useMemo(() => {
    const out: Array<{
      productId: string;
      name: string;
      imageUrl: string | null;
      qty: number;
      unitPrice: number;
      catalogPrice: number;
      lineTotal: number;
    }> = [];
    for (const item of items) {
      const p = products.find((x) => x.id === item.productId);
      if (!p) continue;
      const unitPrice = item.unitPrice ?? p.price;
      out.push({
        productId: p.id,
        name: p.name,
        imageUrl: primaryImageUrl(p.images),
        qty: item.qty,
        unitPrice,
        catalogPrice: p.price,
        lineTotal: mulCop(unitPrice, item.qty),
      });
    }
    return out;
  }, [items, products]);

  const state: CheckoutState = { paymentKind, method, customerId, abonoInput };
  const total = linesTotal(lines);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const valid = canRegister(state, total, lines.length);
  const fiado = fiadoFor(state, total);

  function dispatch(action: CheckoutAction) {
    const next = checkoutReducer(state, action);
    if (next.paymentKind !== state.paymentKind) {
      setPaymentKind(next.paymentKind);
      setAmountReceived(next.paymentKind === "credit" ? 0 : null);
    }
    if (next.customerId !== state.customerId) setCustomerId(next.customerId);
    if (next.method !== state.method) setMethod(next.method);
    if (next.abonoInput !== state.abonoInput) setAbonoInput(next.abonoInput);
  }

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
      const result = await createSaleWithOfflineFallback(
        buildSaleRequest(state, lines, note),
        requestIdRef.current,
      );
      clear();
      setToast(
        result.mode === "offline"
          ? "Venta guardada en este dispositivo · se sincronizará automáticamente."
          : "Venta registrada",
      );
      setTimeout(() => navigateOfflineAware(router, "/"), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al registrar venta");
      setBusy(false);
    }
  }

  const summary = [formatCop(total), KIND_LABEL[paymentKind], showsMethod(state) ? method : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock size="compact" back={{ href: "/ventas/nueva", label: "Volver" }} title="Cobrar">
        <div className="mt-5">
          <HeroAmount
            label="Total"
            value={formatCop(total)}
            caption={
              <button
                type="button"
                onClick={() => setShowLines((v) => !v)}
                aria-expanded={showLines}
                aria-controls="cobrar-lineas"
                className="min-h-11 underline underline-offset-2"
              >
                {itemCount} {itemCount === 1 ? "producto" : "productos"}
              </button>
            }
          />
        </div>
      </HeroBlock>

      <Sheet>
        <section className="flex flex-col gap-2">
          <SectionHead title="¿Cómo pagan?" />
          <ChoiceSegmented
            label="¿Cómo pagan?"
            options={KIND_OPTIONS}
            value={paymentKind}
            onChange={(kind) => dispatch({ type: "kind", kind })}
          />
        </section>

        {showsMethod(state) && (
          <section className="flex flex-col gap-2">
            <SectionHead title="Método" />
            <ChoiceSegmented
              label="¿Cómo recibes?"
              options={METHOD_OPTIONS}
              value={method}
              onChange={(m) => dispatch({ type: "method", method: m })}
            />
          </section>
        )}

        {paymentKind !== "paid" && (
          <CustomerPicker
            customers={customers}
            customerId={customerId}
            pendingIds={pendingCustomerIds}
            onChange={(id) => dispatch({ type: "customer", customerId: id })}
          />
        )}

        {paymentKind === "partial" && (
          <AmountField
            label="Recibido"
            value={abonoInput}
            onChange={(digits) => dispatch({ type: "abono", digits })}
            hint={fiado > 0 ? `Queda debiendo ${formatCop(fiado)}` : undefined}
          />
        )}

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-muted" htmlFor="nota">
            Nota <span className="font-normal normal-case">(opcional)</span>
          </label>
          <input
            id="nota"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej. entrega en la tarde"
            maxLength={200}
            className="mt-2 h-11 w-full rounded-[var(--r-md)] border border-border bg-surface px-3 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cta)]"
          />
        </div>

        {showLines && lines.length > 0 && (
          <section className="flex flex-col gap-2" id="cobrar-lineas">
            <SectionHead title="Productos" />
            <div className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface">
              <ul className="divide-y divide-border">
                {lines.map((l) => (
                  <li key={l.productId} className="flex min-h-14 items-center gap-3 px-3 py-2">
                    <ProductThumbnail secureUrl={l.imageUrl} alt={l.name} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {l.name} ×{l.qty}
                      {l.unitPrice !== l.catalogPrice && (
                        <span className="ml-1 text-ink-muted">({formatCop(l.unitPrice)})</span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCop(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {error && <StateBlock kind="error" title={error} />}
      </Sheet>

      <ActionBar
        summary={summary}
        primary={{ label: "Registrar", onClick: () => void confirm(), disabled: !valid, busy }}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-center text-sm text-bg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
