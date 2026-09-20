import { ApiError, NetworkError } from "../errors";
import { getLocalDb, type DulceCalleLocalDB } from "./db";
import { assertUuid } from "./ids";
import type { OutboxItem, OutboxStatus } from "./types";

export type EnqueueOutboxInput = {
  operationId: string;
  businessId: string;
  entity: OutboxItem["entity"];
  operation: OutboxItem["operation"];
  requestId: string;
  payload: unknown;
  dependsOn?: string[];
  localCreatedAt?: number;
};

function sortFifo(rows: OutboxItem[]): OutboxItem[] {
  return [...rows].sort((a, b) => {
    if (a.localCreatedAt !== b.localCreatedAt) {
      return a.localCreatedAt - b.localCreatedAt;
    }
    return a.operationId.localeCompare(b.operationId);
  });
}

/**
 * Persistent outbox. Survives reload. No flush / sync in M6.1.
 * operationId = local row identity. requestId = HTTP Idempotency-Key.
 */
export class OutboxStore {
  constructor(private readonly db: DulceCalleLocalDB = getLocalDb()) {}

  async enqueue(input: EnqueueOutboxInput): Promise<OutboxItem> {
    assertUuid(input.operationId, "operationId");
    assertUuid(input.businessId, "businessId");
    assertUuid(input.requestId, "requestId");
    const dependsOn = input.dependsOn ?? [];
    for (const dep of dependsOn) assertUuid(dep, "dependsOn");
    const existing = await this.db.outbox.get(input.operationId);
    if (existing) {
      if (existing.businessId !== input.businessId) {
        throw new Error("operationId belongs to another business");
      }
      if (existing.requestId !== input.requestId) {
        throw new Error("operationId already used with a different requestId");
      }
      return existing;
    }
    const byKey = await this.getByRequestId(input.businessId, input.requestId);
    if (byKey) {
      throw new Error("requestId already used");
    }
    const row: OutboxItem = {
      operationId: input.operationId,
      businessId: input.businessId,
      entity: input.entity,
      operation: input.operation,
      requestId: input.requestId,
      payload: input.payload,
      dependsOn,
      localCreatedAt: input.localCreatedAt ?? Date.now(),
      status: "pending",
      remoteId: null,
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
    };
    await this.db.outbox.put(row);
    return row;
  }

  async get(
    businessId: string,
    operationId: string,
  ): Promise<OutboxItem | undefined> {
    assertUuid(businessId, "businessId");
    assertUuid(operationId, "operationId");
    const row = await this.db.outbox.get(operationId);
    if (!row || row.businessId !== businessId) return undefined;
    return row;
  }

  async recoverInFlight(businessId: string): Promise<number> {
    assertUuid(businessId, "businessId");
    const rows = await this.listByStatus(businessId, "in_flight");
    for (const row of rows) {
      await this.db.outbox.put({ ...row, status: "pending", nextAttemptAt: null });
    }
    return rows.length;
  }

  async getByRequestId(
    businessId: string,
    requestId: string,
  ): Promise<OutboxItem | undefined> {
    assertUuid(businessId, "businessId");
    assertUuid(requestId, "requestId");
    return this.db.outbox
      .where("[businessId+requestId]")
      .equals([businessId, requestId])
      .first();
  }

  async listPending(businessId: string): Promise<OutboxItem[]> {
    return this.listByStatus(businessId, "pending");
  }

  async listByStatus(
    businessId: string,
    status: OutboxStatus,
  ): Promise<OutboxItem[]> {
    assertUuid(businessId, "businessId");
    const rows = await this.db.outbox
      .where("[businessId+status]")
      .equals([businessId, status])
      .toArray();
    return sortFifo(rows);
  }

  async markInFlight(businessId: string, operationId: string): Promise<OutboxItem> {
    return this.patchStatus(businessId, operationId, {
      status: "in_flight",
      attemptsDelta: 1,
      lastError: null,
    });
  }

  async markSynced(businessId: string, operationId: string, remoteId: string): Promise<OutboxItem> {
    assertUuid(remoteId, "remoteId");
    return this.patchStatus(businessId, operationId, {
      status: "synced",
      remoteId,
      lastError: null,
      nextAttemptAt: null,
    });
  }

  async markFailed(
    businessId: string,
    operationId: string,
    lastError: string,
    nextAttemptAt?: number | null,
  ): Promise<OutboxItem> {
    return this.patchStatus(businessId, operationId, {
      status: "failed",
      lastError,
      nextAttemptAt: nextAttemptAt ?? null,
    });
  }

  /**
   * M6.9 — Manual retry. Moves a `failed` operation back to `pending`
   * without minting a new intent: same operationId, same requestId,
   * attempts untouched, nextAttemptAt cleared so the next flush picks it
   * up. lastError is kept for display until the next attempt clears it.
   */
  async requeue(businessId: string, operationId: string): Promise<OutboxItem> {
    assertUuid(businessId, "businessId");
    assertUuid(operationId, "operationId");
    const row = await this.db.outbox.get(operationId);
    if (!row) throw new Error("outbox row not found");
    if (row.businessId !== businessId) {
      throw new Error("operationId belongs to another business");
    }
    if (row.status !== "failed") {
      throw new Error(`only failed operations can be retried (status: ${row.status})`);
    }
    const next: OutboxItem = { ...row, status: "pending", nextAttemptAt: null };
    await this.db.outbox.put(next);
    return next;
  }

  /**
   * M6.9 — Explicit discard. Removes a `pending`/`failed` operation, i.e.
   * the local intent. It never reverts a server-side effect and the row is
   * never sent again. Synced rows are history and cannot be discarded.
   */
  async discard(businessId: string, operationId: string): Promise<void> {
    assertUuid(businessId, "businessId");
    assertUuid(operationId, "operationId");
    const row = await this.db.outbox.get(operationId);
    if (!row) throw new Error("outbox row not found");
    if (row.businessId !== businessId) {
      throw new Error("operationId belongs to another business");
    }
    if (row.status !== "pending" && row.status !== "failed") {
      throw new Error(`only pending/failed operations can be discarded (status: ${row.status})`);
    }
    await this.db.outbox.delete(operationId);
  }

  private async patchStatus(
    businessId: string,
    operationId: string,
    patch: {
      status: OutboxStatus;
      remoteId?: string | null;
      lastError: string | null;
      nextAttemptAt?: number | null;
      attemptsDelta?: number;
    },
  ): Promise<OutboxItem> {
    assertUuid(businessId, "businessId");
    assertUuid(operationId, "operationId");
    const row = await this.db.outbox.get(operationId);
    if (!row) throw new Error("outbox row not found");
    if (row.businessId !== businessId) {
      throw new Error("operationId belongs to another business");
    }
    const allowed =
      patch.status === "in_flight"
        ? row.status === "pending" || row.status === "failed"
        : patch.status === "synced" || patch.status === "failed"
          ? row.status === "in_flight"
          : false;
    if (!allowed) {
      throw new Error(`invalid outbox transition: ${row.status} -> ${patch.status}`);
    }
    const next: OutboxItem = {
      ...row,
      status: patch.status,
      remoteId: patch.remoteId === undefined ? row.remoteId : patch.remoteId,
      lastError: patch.lastError,
      nextAttemptAt:
        patch.nextAttemptAt === undefined ? row.nextAttemptAt : patch.nextAttemptAt,
      attempts: row.attempts + (patch.attemptsDelta ?? 0),
    };
    await this.db.outbox.put(next);
    return next;
  }
}

export type OutboxSendResult = { remoteId: string };
export type OutboxSender = (item: OutboxItem) => Promise<OutboxSendResult>;

export type SyncFlushResult = {
  processed: number;
  synced: number;
  failed: number;
  blocked: number;
  stopped: boolean;
};

function isRetryableError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}

function retryAt(attempts: number, now: number): number {
  const delay = Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
  return now + delay;
}

function emitSyncEvent(detail: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("dulcecalle:sync", { detail }));
}


export class ConnectivityMonitor {
  private started = false;
  private readonly listeners = new Set<(online: boolean) => void>();
  private _online = this.readOnline();

  get online(): boolean {
    return this._online;
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
  }

  stop(): void {
    if (!this.started || typeof window === "undefined") return;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    this.started = false;
  }

  refresh(): boolean {
    const next = this.readOnline();
    this.setOnline(next);
    return next;
  }

  private readonly handleOnline = (): void => this.setOnline(true);
  private readonly handleOffline = (): void => this.setOnline(false);

  private readOnline(): boolean {
    return typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" ? true : navigator.onLine;
  }

  private setOnline(next: boolean): void {
    if (this._online === next) return;
    this._online = next;
    for (const listener of this.listeners) listener(next);
  }
}

export class OutboxSyncEngine {
  private readonly active = new Map<string, Promise<SyncFlushResult>>();

  constructor(
    private readonly outbox: OutboxStore = getOutboxStore(),
    private readonly clock: () => number = Date.now,
  ) {}

  async flush(
    businessId: string,
    sender: OutboxSender,
    filter?: (item: OutboxItem) => boolean,
  ): Promise<SyncFlushResult> {
    assertUuid(businessId, "businessId");
    const active = this.active.get(businessId);
    if (active) return active;

    const task = this.flushInternal(businessId, sender, filter);
    this.active.set(businessId, task);
    try {
      return await task;
    } finally {
      if (this.active.get(businessId) === task) this.active.delete(businessId);
    }
  }

  private async flushInternal(
    businessId: string,
    sender: OutboxSender,
    filter?: (item: OutboxItem) => boolean,
  ): Promise<SyncFlushResult> {
    await this.outbox.recoverInFlight(businessId);

    let processed = 0;
    let synced = 0;
    let failed = 0;
    let blocked = 0;
    let stopped = false;
    const now = this.clock();
    // M6.9 — Permanent failures (failed + nextAttemptAt null) are excluded
    // from automatic flushes. They only run again via manual retry, which
    // moves them back to pending. Scheduled retries (nextAttemptAt set and
    // due) keep flowing automatically.
    const rows = [
      ...(await this.outbox.listByStatus(businessId, "pending")),
      ...(await this.outbox.listByStatus(businessId, "failed")).filter(
        (row) => row.nextAttemptAt != null && row.nextAttemptAt <= now,
      ),
    ]
      .filter((row) => !filter || filter(row))
      .sort((a, b) => {
      if (a.localCreatedAt !== b.localCreatedAt) {
        return a.localCreatedAt - b.localCreatedAt;
      }
      return a.operationId.localeCompare(b.operationId);
    });

    if (rows.length > 0) {
      emitSyncEvent({
        type: "start",
        businessId,
        total: rows.length,
      });
    }

    let remaining = rows;

    while (remaining.length > 0 && !stopped) {
      let progress = false;
      const deferred: OutboxItem[] = [];

      for (const candidate of remaining) {
        const current = await this.outbox.get(businessId, candidate.operationId);
        if (!current || (current.status !== "pending" && current.status !== "failed")) {
          progress = true;
          continue;
        }

        if (current.status === "failed" && current.nextAttemptAt != null && current.nextAttemptAt > this.clock()) {
          progress = true;
          continue;
        }

        if (!(await this.dependenciesReady(businessId, current))) {
          deferred.push(current);
          continue;
        }

        progress = true;
        processed += 1;
        const flying = await this.outbox.markInFlight(businessId, current.operationId);
        try {
          const result = await sender(flying);
          assertUuid(result.remoteId, "remoteId");
          await this.outbox.markSynced(businessId, current.operationId, result.remoteId);
          synced += 1;
          emitSyncEvent({
            type: "item",
            businessId,
            entity: current.entity,
            operation: current.operation,
            status: "synced",
            completed: synced,
            total: rows.length,
          });
        } catch (error) {
          const retryable = isRetryableError(error);
          const message = error instanceof Error ? error.message : "Error de sincronización.";
          await this.outbox.markFailed(
            businessId,
            current.operationId,
            message,
            retryable ? retryAt(flying.attempts, this.clock()) : null,
          );
          failed += 1;
          emitSyncEvent({
            type: "item",
            businessId,
            entity: current.entity,
            operation: current.operation,
            status: "failed",
            completed: synced + failed,
            total: rows.length,
            message,
          });
          if (retryable || (error instanceof ApiError && (error.status === 401 || error.status === 403))) {
            stopped = true;
            break;
          }
        }
      }

      if (stopped || !progress) {
        blocked += deferred.length;
        break;
      }
      remaining = deferred;
    }

    const result = { processed, synced, failed, blocked, stopped };
    if (rows.length > 0) {
      emitSyncEvent({
        type: "done",
        businessId,
        result,
      });
    }
    return result;
  }

  private async dependenciesReady(businessId: string, item: OutboxItem): Promise<boolean> {
    for (const dependencyId of item.dependsOn) {
      const dependency = await this.outbox.get(businessId, dependencyId);
      if (!dependency || dependency.status !== "synced") return false;
    }
    return true;
  }
}

let outboxSingleton: OutboxStore | null = null;
let syncEngineSingleton: OutboxSyncEngine | null = null;

export function getOutboxStore(): OutboxStore {
  if (!outboxSingleton) outboxSingleton = new OutboxStore();
  return outboxSingleton;
}

export function resetOutboxStoreSingleton(): void {
  outboxSingleton = null;
}

export function getOutboxSyncEngine(): OutboxSyncEngine {
  if (!syncEngineSingleton) syncEngineSingleton = new OutboxSyncEngine();
  return syncEngineSingleton;
}

export function resetOutboxSyncEngineSingleton(): void {
  syncEngineSingleton = null;
}
