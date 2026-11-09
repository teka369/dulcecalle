import type { LocalDiscardedOp } from "@/data/local/types";
import type { RemoteClientEvent } from "@/data/http/repository";

export type HistoryRow = {
  operationId: string;
  entity: string;
  operation: string;
  state: "discarded" | "replaced";
  amount: number | null;
  lastError: string | null;
  replacedBy: string | null;
  localCreatedAt: number;
  discardedAt: number;
  /** server = this phone's row is backed up; other-device = only the server has it; local = not yet backed up. */
  backup: "server" | "local" | "other-device";
};

/**
 * C01.1 / C01-INV-04 — one history row per operation: local discardedOps
 * merged with the server trace (discarded/replaced events), no duplicates.
 * `server === null` means it could not be read (offline / not owner).
 */
export function mergeHistory(local: LocalDiscardedOp[], server: RemoteClientEvent[] | null): HistoryRow[] {
  const byOp = new Map<string, HistoryRow>();
  const backed = new Set(
    (server ?? []).filter((e) => e.kind === "discarded" || e.kind === "replaced").map((e) => e.operationId),
  );
  for (const r of local) {
    byOp.set(r.operationId, {
      operationId: r.operationId,
      entity: r.entity,
      operation: r.operation,
      state: r.state,
      amount: r.amount,
      lastError: r.lastError,
      replacedBy: r.replacedBy,
      localCreatedAt: r.localCreatedAt,
      discardedAt: r.discardedAt,
      backup: backed.has(r.operationId) ? "server" : "local",
    });
  }
  for (const e of server ?? []) {
    if (e.kind !== "discarded" && e.kind !== "replaced") continue;
    if (byOp.has(e.operationId)) continue;
    const at = Date.parse(e.createdAt);
    byOp.set(e.operationId, {
      operationId: e.operationId,
      entity: e.entity,
      operation: e.operation,
      state: e.kind,
      amount: e.amount,
      lastError: e.lastError,
      replacedBy: e.replacedBy,
      localCreatedAt: e.deviceCreatedAt ? Date.parse(e.deviceCreatedAt) : at,
      discardedAt: at,
      backup: "other-device",
    });
  }
  return [...byOp.values()].sort((a, b) => b.discardedAt - a.discardedAt);
}
