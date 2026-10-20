import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLocalDbForTests } from "@/data/local/db";
import { getOutboxStore, resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";

/** Tester loop-v1 HIGH: offline open → shrink → preparar → close, one reconnect sync. */
const businessId = "11111111-1111-4111-8111-111111111111";
const P = "33333333-3333-4333-8333-333333333333";
const T = "44444444-4444-4444-8444-444444444444";
const order: string[] = [];
const id = () => crypto.randomUUID();
const api = {
  session: { businessId },
  cash: {
    open: vi.fn(async () => { order.push("open"); return { id: id() }; }),
    close: vi.fn(async () => { order.push("close"); return { id: id() }; }),
  },
  inventory: { shrink: vi.fn(async () => { order.push("shrink"); return { id: id() }; }) },
  production: { prepare: vi.fn(async () => { order.push("prepare"); return { id: id() }; }) },
};
vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));
import { syncAllPending } from "./sync-coordinator";

beforeEach(async () => {
  resetOutboxStoreSingleton();
  resetOutboxSyncEngineSingleton();
  resetLocalStoreSingleton();
  await __resetLocalDbForTests();
  order.length = 0;
});

describe("reconnect sync keeps FIFO across cash, stock and preparation ops", () => {
  it("open → shrink → prepare → close, all synced in ONE pass", async () => {
    const t0 = Date.now();
    const open = id();
    const q = (operationId: string, entity: string, operation: string, payload: unknown, dependsOn: string[], dt: number) =>
      getOutboxStore().enqueue({ operationId, businessId, entity, operation, requestId: id(), payload, dependsOn, localCreatedAt: t0 + dt } as never);
    await q(open, "cashSession", "open", { openingFloat: 9000 }, [], 1);
    await q(id(), "stockMove", "shrink", { productId: T, qty: 1, reason: "perdido" }, [], 2);
    await q(id(), "preparation", "create", { sourceId: P, targetId: T, qty: 3, unitCost: 0 }, [open], 3);
    await q(id(), "cashSession", "close", { sessionId: open, countedEfectivo: 9000 }, [open], 4);

    await syncAllPending(businessId);

    expect(order).toEqual(["open", "shrink", "prepare", "close"]);
    expect(await getOutboxStore().listPending(businessId)).toHaveLength(0);
  });
});
