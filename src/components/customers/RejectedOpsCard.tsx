"use client";

import Link from "next/link";
import { formatCop } from "@/domain/money";
import type { UnresolvedFinancialOp } from "@/data/pwa/unresolved-financial";

/**
 * C01 / DC-01 — a rejected money op of this customer never disappears silently.
 * Text + border tone (never color alone).
 */
export function RejectedOpsCard({
  ops,
  serverDebt,
  localDebt,
}: {
  ops: UnresolvedFinancialOp[];
  serverDebt: number | null;
  localDebt: number;
}) {
  const rejected = ops.filter((op) => op.state === "rejected");
  if (rejected.length === 0) return null;
  const abonos = rejected.filter((op) => op.entity === "customerPayment").length;
  const title =
    abonos === rejected.length
      ? `${abonos} ${abonos === 1 ? "abono rechazado" : "abonos rechazados"}`
      : `${rejected.length} ${rejected.length === 1 ? "operación rechazada" : "operaciones rechazadas"}`;
  return (
    <section
      role="status"
      aria-label={title}
      className="mt-3 rounded-[var(--r-lg)] border border-danger bg-danger-soft p-3"
      data-testid="rejected-ops-card"
    >
      <p className="text-sm font-semibold text-danger">{title}</p>
      <ul className="mt-1 text-sm">
        {rejected.map((op) => (
          <li key={op.operationId}>
            {op.amount != null ? `${formatCop(op.amount)} · ` : ""}{op.reason ?? "El servidor no la aceptó"}
          </li>
        ))}
      </ul>
      {serverDebt != null && serverDebt !== localDebt ? (
        <p className="mt-1 text-sm text-muted">En el servidor: {formatCop(serverDebt)}</p>
      ) : null}
      <Link href="/sincronizacion" className="mt-2 inline-block text-sm font-semibold underline">
        Resolver
      </Link>
    </section>
  );
}
