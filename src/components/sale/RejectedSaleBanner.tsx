"use client";

import { useEffect, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { getOutboxStore } from "@/data/local/outbox";
import { formatCop } from "@/domain/money";

type SalePayload = { lines?: Array<{ productId?: string; qty?: number; unitPrice?: number }> };

/**
 * C01.1 (UX-C01 §4.3, A2) — «Registrar de nuevo» a rejected sale: nothing is
 * prefilled (cart prefill is C08); the original lines are shown as reference.
 */
export function RejectedSaleBanner({ productName }: { productName: (id: string) => string | null }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("rechazada")?.trim();
    const businessId = getPwaAuthSession().businessId;
    if (!raw || !/^[0-9a-zA-Z-]{1,64}$/.test(raw) || !businessId) return;
    void getOutboxStore()
      .get(businessId, raw)
      .then(async (op) => {
        if (!op || op.entity !== "sale") return;
        const { summarizeOutboxMoney } = await import("@/data/local/outbox-money");
        const { getLocalDb } = await import("@/data/local/db");
        const money = await summarizeOutboxMoney(getLocalDb(), op);
        const lines = ((op.payload as SalePayload).lines ?? [])
          .map((l) => `${(l.productId && productName(l.productId)) || "Producto"} ×${l.qty ?? 1}`)
          .join(", ");
        setText(`Registra de nuevo la venta de ${formatCop(money.amount ?? 0)}${lines ? `: ${lines}` : ""}.`);
      })
      .catch(() => undefined);
  }, [productName]);
  if (!text) return null;
  return (
    <p role="status" data-testid="rejected-sale-banner" className="rounded-[var(--r-lg)] bg-info-soft px-3 py-2.5 text-sm text-info">
      {text}
    </p>
  );
}

/** Keeps `?rechazada=<opId>` when moving from Nueva venta to Cobrar. */
export function withRejectedParam(href: string): string {
  if (typeof window === "undefined") return href;
  const raw = new URLSearchParams(window.location.search).get("rechazada");
  return raw ? `${href}?rechazada=${encodeURIComponent(raw)}` : href;
}
