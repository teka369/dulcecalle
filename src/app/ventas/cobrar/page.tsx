"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatCop, mulCop, addCop, subCop } from "@/domain/money";
import type { Customer, PaymentKind, Product } from "@/domain/types";
import {
  customerRepository,
  productRepository,
  saleRepository,
} from "@/repositories";
import { useCart } from "@/store/cartStore";

export default function CobrarPage() {
  const router = useRouter();
  const {
    items,
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
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [abonoInput, setAbonoInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void productRepository.list().then(setProducts);
    void customerRepository.list().then(setCustomers);
  }, []);

  useEffect(() => {
    if (items.length === 0) {
      router.replace("/ventas/nueva");
    }
  }, [items.length, router]);

  const lines = useMemo(() => {
    return items
      .map((item) => {
        const p = products.find((x) => x.id === item.productId);
        if (!p) return null;
        const unitPrice = item.unitPrice ?? p.price;
        return {
          productId: p.id!,
          name: p.name,
          qty: item.qty,
          unitPrice,
          catalogPrice: p.price,
          lineTotal: mulCop(unitPrice, item.qty),
        };
      })
      .filter(Boolean) as Array<{
      productId: number;
      name: string;
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

      await saleRepository.createSale({
        lines: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
        paymentKind,
        customerId:
          paymentKind === "paid" ? null : (customerId as number),
        amountReceived: received,
        method: paymentKind === "credit" ? "Efectivo" : method,
      });

      clear();
      setToast("Venta registrada");
      setTimeout(() => {
        router.push("/");
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
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Cobrar</h1>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
        <h2 className="text-sm font-semibold text-ink/60">Resumen</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {lines.map((l) => (
            <li key={l.productId} className="flex justify-between text-sm">
              <span>
                {l.name} ×{l.qty}
                {l.unitPrice !== l.catalogPrice && (
                  <span className="ml-1 text-ink/45">
                    ({formatCop(l.unitPrice)})
                  </span>
                )}
              </span>
              <span className="font-medium">{formatCop(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-ink/10 pt-3 text-base font-semibold">
          <span>Total</span>
          <span>{formatCop(total)}</span>
        </div>
      </section>

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
        <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
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
        </section>
      )}

      {paymentKind === "partial" && (
        <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
          <label className="text-sm font-medium" htmlFor="abono">
            Abono
          </label>
          <input
            id="abono"
            inputMode="numeric"
            value={abonoInput}
            onChange={(e) =>
              setAbonoInput(e.target.value.replace(/\D/g, ""))
            }
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
            placeholder="0"
          />
          {abono > 0 && abono < total && (
            <p className="mt-2 text-sm text-ink/70">
              Queda debiendo {formatCop(quedaDebiendo)}
            </p>
          )}
          <CustomerPicker
            customers={customers}
            customerId={customerId}
            onChange={setCustomerId}
          />
        </section>
      )}

      {paymentKind === "credit" && (
        <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
          <CustomerPicker
            customers={customers}
            customerId={customerId}
            onChange={setCustomerId}
          />
        </section>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void confirm()}
            className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            Confirmar venta
          </button>
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
  const activeBg =
    color === "ok"
      ? "bg-ok text-white"
      : color === "primary"
        ? "bg-primary text-ink"
        : "bg-accent text-white";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-[14px] border px-2 text-sm font-semibold ${
        active ? activeBg : "border-ink/10 bg-white text-ink/70"
      }`}
    >
      {label}
    </button>
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

function CustomerPicker({
  customers,
  customerId,
  onChange,
}: {
  customers: Customer[];
  customerId: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <div className="mt-3">
      <label className="text-sm font-medium" htmlFor="cliente">
        Cliente
      </label>
      <select
        id="cliente"
        className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 bg-white px-3 text-base"
        value={customerId ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
      >
        <option value="">Selecciona cliente</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
