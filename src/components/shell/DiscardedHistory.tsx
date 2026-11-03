"use client";

import { useEffect, useState } from "react";
import { getLocalDb } from "@/data/local/db";
import type { LocalDiscardedOp } from "@/data/local/types";
import { getPwaAuthSession } from "@/data/http/session";
import { describeOutboxOperation } from "@/data/pwa/sync-tray";
import { localRef } from "@/data/pwa/local-ref";
import { formatCop } from "@/domain/money";
import { Badge } from "@/components/ui/Badge";
import { SectionHead } from "@/components/ui/SectionHead";

/**
 * C01 / DC-14 — Descartar never erases a money op: it stays here as
 * «Descartada» or «Reemplazada» (with the link to its correction).
 */
export function DiscardedHistory({ refreshKey }: { refreshKey?: unknown }) {
  const [rows, setRows] = useState<LocalDiscardedOp[]>([]);
  useEffect(() => {
    let alive = true;
    const businessId = getPwaAuthSession().businessId;
    if (!businessId) return;
    void getLocalDb()
      .discardedOps.where("[businessId+discardedAt]")
      .between([businessId, 0], [businessId, Number.MAX_SAFE_INTEGER])
      .reverse()
      .limit(50)
      .toArray()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="discarded-history">
      <SectionHead title="Historial" />
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-[var(--r-lg)] border border-border bg-surface p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{describeOutboxOperation(r.entity, r.operation)}</span>
              <Badge tone={r.state === "replaced" ? "info" : "warning"}>
                {r.state === "replaced" ? "Reemplazada" : "Descartada"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {localRef(r.operationId, r.localCreatedAt)}
              {r.amount != null ? ` · ${formatCop(r.amount)}` : ""}
              {r.lastError ? ` · Motivo: ${r.lastError}` : ""}
            </p>
            {r.replacedBy ? (
              <p className="mt-1 text-xs">Reemplazada por {localRef(r.replacedBy, r.discardedAt)}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
