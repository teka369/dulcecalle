import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import {
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { paymentValues, createSaleWithOfflineFallback } from "./offline-sales";

const BIZ = "11111111-1111-4111-8111-111111111111";
const COMBO = "33333333-3333-4333-8333-333333333333";

const api = {
  session: { businessId: BIZ },
  sales: { create: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

describe("M6.5 offline sales validation", () => {
  it("accepts a fully paid cash sale", () => {
    expect(paymentValues({
      lines: [{ productId: "p", qty: 1 }],
      paymentKind: "paid",
      amountReceived: 500,
      method: "Efectivo",
    }, 500)).toEqual({ received: 500, credit: 0 });
  });

  it("calculates credit for a partial sale", () => {
    expect(paymentValues({
      lines: [{ productId: "p", qty: 1 }],
      paymentKind: "partial",
      customerId: "c",
      amountReceived: 300,
      method: "Nequi",
    }, 500)).toEqual({ received: 300, credit: 200 });
  });

  it("rejects a credit sale with received money", () => {
    expect(() => paymentValues({
      lines: [{ productId: "p", qty: 1 }],
      paymentKind: "credit",
      customerId: "c",
      amountReceived: 1,
    }, 500)).toThrow("La venta fiada no recibe dinero.");
  });
});

describe("insumo sale guard (offline mirror)", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = BIZ;
  });

  it("refuses to sell a combo offline without writing anything", async () => {
    const now = Date.now();
    await getLocalDb().products.put({
      id: COMBO,
      businessId: BIZ,
      name: "Combo enchiladas",
      category: "General",
      price: 105000,
      avgCost: 105000,
      stock: 1,
      lowStockAt: 5,
      sellable: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      images: [],
    } as never);
    api.sales.create.mockRejectedValue(new NetworkError("offline"));
    await expect(
      createSaleWithOfflineFallback(
        {
          lines: [{ productId: COMBO, qty: 1 }],
          paymentKind: "paid",
          amountReceived: 105000,
          method: "Efectivo",
        },
        "55555555-5555-4555-8555-555555555555",
      ),
    ).rejects.toThrow("insumo");
    expect(await getLocalDb().sales.count()).toBe(0);
    expect(await getLocalDb().stockMoves.count()).toBe(0);
  });
});
