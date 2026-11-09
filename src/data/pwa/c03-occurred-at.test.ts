import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import {
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { createSaleWithOfflineFallback, syncPendingSales } from "./offline-sales";
import { createPaymentWithOfflineFallback, syncPendingPayments } from "./offline-payments";

const BIZ = "11111111-1111-4111-8111-111111111111";
const PROD = "22222222-2222-4222-8222-222222222222";
const CUS = "33333333-3333-4333-8333-333333333333";

const api = {
  session: { businessId: BIZ },
  sales: { create: vi.fn() },
  customers: { pay: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

function sameInstant(value: unknown, epochMs: number): boolean {
  if (value == null) return false;
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(ms) && Math.abs(ms - epochMs) < 2000;
}

describe("C03 client: offline ops keep the original occurredAt on sync", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = BIZ;
    const now = Date.now();
    await getLocalDb().products.put({
      id: PROD,
      businessId: BIZ,
      name: "Gomitas",
      category: "General",
      price: 2_000,
      avgCost: 400,
      stock: 10,
      lowStockAt: 2,
      sellable: true,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      images: [],
    });
    await getLocalDb().customers.put({
      id: CUS,
      businessId: BIZ,
      code: "DC-0001",
      name: "Ana",
      phone: null,
      debt: 50_000,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("C03-U1 abono offline sincronizado 2h después envía occurredAt = hora original", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-11-03T14:00:00Z").getTime();
    vi.setSystemTime(t0);
    api.customers.pay.mockRejectedValueOnce(new NetworkError("offline"));
    const payment = await createPaymentWithOfflineFallback(
      { customerId: CUS, amount: 20_000, method: "Efectivo" },
      newEntityId(),
    );
    if (payment.mode !== "offline") throw new Error("expected offline payment");
    vi.setSystemTime(t0 + 2 * 3600_000);
    api.customers.pay.mockResolvedValueOnce({
      id: newEntityId(),
      customerId: CUS,
      amount: 20_000,
      method: "Efectivo",
    });
    await syncPendingPayments(BIZ);
    const body = api.customers.pay.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    vi.useRealTimers();
    expect(sameInstant(body?.occurredAt, t0)).toBe(true);
  });

  it("C03-U2 venta offline sincronizada 2h después envía occurredAt = hora original", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-11-03T14:00:00Z").getTime();
    vi.setSystemTime(t0);
    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    await createSaleWithOfflineFallback(
      {
        lines: [{ productId: PROD, qty: 1, unitPrice: 2_000 }],
        paymentKind: "paid",
        amountReceived: 2_000,
        method: "Efectivo",
      },
      newEntityId(),
    );
    vi.setSystemTime(t0 + 2 * 3600_000);
    api.sales.create.mockResolvedValueOnce({
      id: newEntityId(),
      customerId: null,
      paymentKind: "paid",
      method: "Efectivo",
      saleTotal: 2000,
      amountReceived: 2000,
      credit: 0,
      note: null,
      occurredOn: "2026-11-03",
      createdAt: t0,
      lines: [],
    });
    await syncPendingSales(BIZ);
    const call = api.sales.create.mock.calls.at(-1) ?? [];
    const body = call.find(
      (a: unknown) => a && typeof a === "object" && "lines" in (a as object),
    ) as Record<string, unknown>;
    vi.useRealTimers();
    expect(sameInstant(body?.occurredAt, t0)).toBe(true);
  });
});
