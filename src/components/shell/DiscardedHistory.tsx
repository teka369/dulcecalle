"use client";

import { useEffect, useState } from "react";
import { getLocalDb } from "@/data/local/db";
import { getPwaAuthSession } from "@/data/http/session";
import { getPwaApi } from "@/data/pwa/api";
import { describeOutboxOperation } from "@/data/pwa/sync-tray";
import { localRef } from "@/data/pwa/local-ref";
import { mergeHistory, type HistoryRow } from "@/data/pwa/op-history";
import { formatCop } from "@/domain/money";
import { Badge } from "@/components/ui/Badge";
import { SectionHead } from "@/components/ui/SectionHead";

/**
 * C01 / DC-14 + C01.1 / C01-INV-04 — Descartar never erases a money op: it
 * stays here as «Descartada» or «Reemplazada». Rows come from this phone
 * (discardedOps) merged with the server trace (any device), one per op.
 */
export function DiscardedHistory({ refreshKey }: { refreshKey?: unknown }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  useEffect(() => {
    let alive = true;
    const businessId = getPwaAuthSession().businessId;
    if (!businessId) return;
    void (async () => {
      const local = await getLocalDb()
        .discardedOps.where("[businessId+discardedAt]")
        .between([businessId, 0], [businessId, Number.MAX_SAFE_INTEGER])
        .reverse()
        .limit(50)
        .toArray()
        .catch(() => []);
      const server = await getPwaApi().audit.list().catch(() => null);
      if (alive) setRows(mergeHistory(local, server));
    })();
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
          <li key={r.operationId} data-testid="history-row" className="rounded-[var(--r-lg)] border border-border bg-surface p-3 text-sm">
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
            <p className="mt-1 text-xs text-ink-muted" data-testid="history-backup">
              {r.backup === "server" ? "Respaldada en el servidor" : r.backup === "other-device" ? "Registrada en otro dispositivo" : "Sin respaldar en el servidor todavía"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
