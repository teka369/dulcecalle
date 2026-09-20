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

  async markInFlight(operationId: string): Promise<OutboxItem> {
    return this.patchStatus(operationId, {
      status: "in_flight",
      attemptsDelta: 1,
      lastError: null,
    });
  }

  async markSynced(operationId: string, remoteId: string): Promise<OutboxItem> {
    assertUuid(remoteId, "remoteId");
    return this.patchStatus(operationId, {
      status: "synced",
      remoteId,
      lastError: null,
      nextAttemptAt: null,
    });
  }

  async markFailed(
    operationId: string,
    lastError: string,
    nextAttemptAt?: number | null,
  ): Promise<OutboxItem> {
    return this.patchStatus(operationId, {
      status: "failed",
      lastError,
      nextAttemptAt: nextAttemptAt ?? null,
    });
  }

  private async patchStatus(
    operationId: string,
    patch: {
      status: OutboxStatus;
      remoteId?: string | null;
      lastError: string | null;
      nextAttemptAt?: number | null;
      attemptsDelta?: number;
    },
  ): Promise<OutboxItem> {
    assertUuid(operationId, "operationId");
    const row = await this.db.outbox.get(operationId);
    if (!row) throw new Error("outbox row not found");
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

let outboxSingleton: OutboxStore | null = null;

export function getOutboxStore(): OutboxStore {
  if (!outboxSingleton) outboxSingleton = new OutboxStore();
  return outboxSingleton;
}

export function resetOutboxStoreSingleton(): void {
  outboxSingleton = null;
}
