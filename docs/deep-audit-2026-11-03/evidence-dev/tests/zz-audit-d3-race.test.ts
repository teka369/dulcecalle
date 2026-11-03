// AUDIT D3 (throwaway, NO commit): carrera snapshot servidor vs estado outbox del abono.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { getLocalStore, resetLocalStoreSingleton } from "@/data/local/store";
import { resetOutboxStoreSingleton } from "@/data/local/outbox";
import { CatalogReadCache } from "./read-cache";

const BIZ = "[REDACTED]";
const CID = "[REDACTED]";
const OP = "[REDACTED]";
const REQ = "[REDACTED]";
const srv = (debt: number) => ({ id: CID, code: "DC-0001", name: "Ana", phone: null, debt, archivedAt: null, createdAt: 1000 });

async function seed(status: string) {
  const db = getLocalDb();
  await db.customers.put({ id: CID, businessId: BIZ, code: "DC-0001", name: "Ana", phone: null, debt: 6000, archivedAt: null, createdAt: 1000, updatedAt: 1000 } as never);
  await db.outbox.put({ operationId: OP, businessId: BIZ, entity: "customerPayment", operation: "pay", requestId: REQ,
    payload: { customerId: CID, amount: 4000, method: "Efectivo" }, dependsOn: [], localCreatedAt: 1, status,
    remoteId: null, attempts: 0, lastError: null, nextAttemptAt: null } as never);
}

describe("AUDIT D3 carrera lista clientes vs sync de abono", () => {
  beforeEach(async () => { resetOutboxStoreSingleton(); resetLocalStoreSingleton(); await __resetLocalDbForTests(); });
  const cache = () => new CatalogReadCache(getLocalStore(), getLocalDb());

  it("A: snapshot leído ANTES del commit, op marcada synced antes de proyectar -> deuda vieja (abono invisible)", async () => {
    await seed("in_flight");
    const r = await cache().listCustomers(BIZ, async () => {
      const snap = [srv(10000)]; // servidor aún sin el abono
      await getLocalDb().outbox.update(OP, { status: "synced" }); // sync termina mientras viaja la respuesta
      return snap;
    });
    console.log("A deuda mostrada:", r.data[0].debt, "deuda real servidor post-commit: 6000");
    expect(r.data[0].debt).toBe(10000);
  });

  it("B: snapshot leído DESPUÉS del commit pero op aún in_flight -> abono restado dos veces", async () => {
    await seed("in_flight");
    const r = await cache().listCustomers(BIZ, async () => [srv(6000)]);
    console.log("B deuda mostrada:", r.data[0].debt, "deuda real: 6000");
    expect(r.data[0].debt).toBe(2000);
  });
});
