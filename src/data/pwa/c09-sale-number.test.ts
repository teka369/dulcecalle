import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { mapPayment, mapSale } from "@/data/http/mappers";
import { saleReference } from "@/domain/sale-number";
import { createSaleWithOfflineFallback, listLocalSales, syncPendingSales } from "./offline-sales";

const BIZ = "11111111-1111-4111-8111-111111111111";
const PROD = "22222222-2222-4222-8222-222222222222";

const api = {
  session: { businessId: BIZ },
  sales: { create: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

/** C09-PR1 T3 — offline sale: L-AAMMDD-XXXX until synced, then the server DC- number replaces it. */
describe("C09-PR1 sale numbers on the device", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
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
  });

  it("T3: offline sale shows «Ref. local L-…»; after sync it shows DC-000007 and the local ref is gone", async () => {
    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    const created = await createSaleWithOfflineFallback(
      { lines: [{ productId: PROD, qty: 1, unitPrice: 2_000 }], paymentKind: "paid", amountReceived: 2_000, method: "Efectivo" },
      newEntityId(),
    );
    expect(created.mode).toBe("offline");
    const [pending] = await listLocalSales(BIZ);
    expect(pending!.pending).toBe(true);
    expect(pending!.localRef).toMatch(/^L-\d{6}-[0-9A-Z]{4}$/);
    expect(pending!.number).toBeUndefined();
    expect(saleReference(pending!)).toBe(`Ref. local ${pending!.localRef}`);

    api.sales.create.mockResolvedValueOnce({
      id: newEntityId(),
      number: "DC-000007",
      customerId: null,
      paymentKind: "paid",
      method: "Efectivo",
      saleTotal: 2000,
      amountReceived: 2000,
      credit: 0,
      note: null,
      occurredOn: "2026-11-09",
      createdAt: Date.now(),
      lines: [],
    });
    await syncPendingSales(BIZ);
    const [synced] = await listLocalSales(BIZ);
    expect(synced!.pending).toBe(false);
    expect(synced!.localRef).toBeUndefined();
    expect(synced!.number).toBe("DC-000007");
    expect(saleReference(synced!)).toBe("DC-000007");
  });

  it("saleReference: pending wins over a number; nothing when there is neither", () => {
    expect(saleReference({ pending: true, localRef: "L-261109-AB12", number: "DC-000001" })).toBe("Ref. local L-261109-AB12");
    expect(saleReference({ pending: false, number: "DC-000125" })).toBe("DC-000125");
    expect(saleReference({ pending: false })).toBeNull();
  });

  it("mappers keep the server numbers (DC- sale, DC-P- abono)", () => {
    const base = {
      id: "44444444-4444-4444-8444-444444444444",
      customerId: null,
      paymentKind: "paid",
      method: "Efectivo",
      saleTotal: 1000,
      amountReceived: 1000,
      credit: 0,
      note: null,
      occurredOn: "2026-11-09",
      createdAt: "2026-11-09T15:00:00.000Z",
      lines: [],
    };
    expect(mapSale({ ...base, number: "DC-000125" }).number).toBe("DC-000125");
    expect(mapSale(base).number).toBeUndefined();
    const pay = mapPayment({
      id: "55555555-5555-4555-8555-555555555555",
      customerId: "66666666-6666-4666-8666-666666666666",
      amount: 500,
      method: "Nequi",
      note: null,
      occurredOn: "2026-11-09",
      createdAt: "2026-11-09T15:00:00.000Z",
      number: "DC-P-000045",
    });
    expect(pay.number).toBe("DC-P-000045");
  });
});
