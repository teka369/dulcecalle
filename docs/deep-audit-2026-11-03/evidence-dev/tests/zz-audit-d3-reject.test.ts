// AUDIT D3 (throwaway, NO commit): rechazo permanente de abono offline -> deuda vuelve y efectivo desaparece del registro local.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { resetOutboxStoreSingleton } from "@/data/local/outbox";
import { cleanupOutboxLocalEffect } from "./outbox-cleanup";

const BIZ = "[REDACTED]";
const CID = "[REDACTED]";
const OP = "[REDACTED]";
const REQ = "[REDACTED]";

describe("AUDIT D3 rechazo abono offline (p.ej. 409 CLOSED_DAY / ABONO_EXCEEDS_DEBT)", () => {
  beforeEach(async () => { resetOutboxStoreSingleton(); resetLocalStoreSingleton(); await __resetLocalDbForTests(); });
  it("revierte deuda y borra cashMove debt_collect", async () => {
    const db = getLocalDb();
    // estado tras abono offline de 4000 sobre deuda 10000
    await db.customers.put({ id: CID, businessId: BIZ, code: "DC-0001", name: "Ana", phone: null, debt: 6000, archivedAt: null, createdAt: 1, updatedAt: 1 } as never);
    await db.customerPayments.put({ id: OP, businessId: BIZ, customerId: CID, amount: 4000, method: "Efectivo", saleId: null, requestId: REQ, note: null, occurredOn: "2026-11-02", createdAt: 1 } as never);
    await db.cashMoves.put({ id: "[REDACTED]", businessId: BIZ, amount: 4000, direction: "in", method: "Efectivo", kind: "debt_collect", sessionId: null, refType: "customer_payment", refId: OP, requestId: REQ, note: null, occurredOn: "2026-11-02", createdAt: 1 } as never);
    const row = { operationId: OP, businessId: BIZ, entity: "customerPayment", operation: "pay", requestId: REQ, payload: { customerId: CID, amount: 4000, method: "Efectivo" }, dependsOn: [], localCreatedAt: 1, status: "failed", remoteId: null, attempts: 1, lastError: "CLOSED_DAY", nextAttemptAt: null } as never;
    await db.outbox.put(row);
    await cleanupOutboxLocalEffect(db, BIZ, row, "reject");
    const c = await db.customers.get(CID);
    const moves = await db.cashMoves.toArray();
    const pay = await db.customerPayments.get(OP);
    console.log("deuda tras rechazo:", c?.debt, "cashMoves:", moves.length, "fila abono local existe:", !!pay);
    expect(c?.debt).toBe(10000);
    expect(moves.length).toBe(0);
  });
});
