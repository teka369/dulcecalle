import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { __reopenLocalDbForTests, __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import {
  closeCashWithOfflineFallback,
  openCashWithOfflineFallback,
  recordAporteOffline,
  recordExpenseWithOfflineFallback,
  recordRetiroOffline,
  shrinkWithOfflineFallback,
  surtirWithOfflineFallback,
  syncPendingOperations,
} from "./offline-operations";

const businessId = "11111111-1111-4111-8111-111111111111";
const otherBusinessId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const supplierId = "44444444-4444-4444-8444-444444444444";

const api = {
  session: { businessId },
  cash: {
    open: vi.fn(),
    close: vi.fn(),
    aporte: vi.fn(),
    retiro: vi.fn(),
    recordExpense: vi.fn(),
  },
  inventory: { surtir: vi.fn(), shrink: vi.fn() },
};

vi.mock("@/data/pwa/api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

function productRow(stock = 10, avgCost = 100, sellable = true) {
  return {
    id: productId,
    businessId,
    name: "Gomitas",
    category: "General",
    price: 500,
    avgCost,
    stock,
    lowStockAt: 5,
    archivedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    images: [],
  };
}

beforeEach(async () => {
  resetOutboxSyncEngineSingleton();
  resetOutboxStoreSingleton();
  await __resetLocalDbForTests();
  api.cash.open.mockReset();
  api.cash.close.mockReset();
  api.cash.aporte.mockReset();
  api.cash.retiro.mockReset();
  api.cash.recordExpense.mockReset();
  api.inventory.surtir.mockReset();
  api.inventory.shrink.mockReset();
});

describe("M6.8 offline operations", () => {
  it("mirrors server validation before queueing invalid cash operations", async () => {
    api.cash.open.mockRejectedValue(new NetworkError("offline"));
    api.cash.aporte.mockRejectedValue(new NetworkError("offline"));
    api.cash.recordExpense.mockRejectedValue(new NetworkError("offline"));

    await expect(
      openCashWithOfflineFallback(-1, "41414141-4141-4141-8414-414141414141"),
    ).rejects.toThrow("El monto no puede ser negativo.");

    await expect(
      recordAporteOffline(
        { amount: 0, method: "Efectivo" },
        "42424242-4242-4242-8424-424242424242",
      ),
    ).rejects.toThrow("El monto tiene que ser mayor a 0.");

    await expect(
      recordExpenseWithOfflineFallback(
        { amount: 100, category: "   ", method: "Efectivo" },
        "43434343-4343-4343-8434-434343434343",
      ),
    ).rejects.toThrow("Di en qué se gastó.");

    expect(await getLocalDb().outbox.where("businessId").equals(businessId).count()).toBe(0);
  });

  it("mirrors closed-day protection for offline shrink", async () => {
    // Semantic "today": the closed session must match the day the code
    // under test considers today, otherwise the guard legitimately passes.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await getLocalDb().cashSessions.put({
      id: "44444444-4444-4444-8444-444444444444",
      businessId,
      localDate: today,
      openedAt: Date.now() - 1000,
      closedAt: Date.now(),
      openingFloat: 5000,
      closingCount: 5000,
      expectedEfectivo: 5000,
      expectedNequi: 0,
      difference: 0,
      note: null,
      createdAt: Date.now() - 1000,
      updatedAt: Date.now(),
    });
    await getLocalDb().products.put(productRow(10, 120));
    api.inventory.shrink.mockRejectedValue(new NetworkError("offline"));

    await expect(
      shrinkWithOfflineFallback(
        { productId, qty: 1, reason: "perdido" },
        "45454545-4545-4454-8454-454545454545",
      ),
    ).rejects.toThrow("La caja de hoy ya está cerrada.");

    expect((await getLocalDb().products.get(productId))?.stock).toBe(10);
    expect(await getLocalDb().outbox.where("businessId").equals(businessId).count()).toBe(0);
  });

  it("opens cash locally and survives a Dexie reopen", async () => {
    api.cash.open.mockRejectedValue(new NetworkError("offline"));
    const result = await openCashWithOfflineFallback(10000, "55555555-5555-4555-8555-555555555555");
    const id = (result as { mode: "offline"; id: string }).id;

    expect(result.mode).toBe("offline");
    expect((await getLocalDb().cashSessions.get(id))?.openingFloat).toBe(10000);
    expect((await getOutboxStore().get(businessId, id))?.operation).toBe("open");

    __reopenLocalDbForTests();
    expect(await getLocalDb().cashSessions.get(id)).toBeTruthy();
    expect(await getLocalDb().outbox.get(id)).toBeTruthy();
  });

  it("persists an online-opened cash session for later offline use", async () => {
    api.cash.open.mockResolvedValue({
      id: "12121212-1212-4121-8121-121212121212",
      localDate: "2026-09-20",
      openedAt: Date.now(),
      closedAt: null,
      openingFloat: 5000,
      closingCount: null,
      expectedEfectivo: null,
      expectedNequi: null,
      difference: null,
    });

    const result = await openCashWithOfflineFallback(5000, "13131313-1313-4131-8131-131313131313");

    expect(result.mode).toBe("online");
    expect(
      (await getLocalDb().cashSessions.get("12121212-1212-4121-8121-121212121212"))?.openingFloat,
    ).toBe(5000);
  });

  it("closes an offline cash session after its open dependency", async () => {
    api.cash.open.mockRejectedValue(new NetworkError("offline"));
    const opened = await openCashWithOfflineFallback(5000, "14141414-1414-4141-8141-141414141414");
    const sessionId = (opened as { mode: "offline"; id: string }).id;
    api.cash.close.mockRejectedValue(new NetworkError("offline"));

    const result = await closeCashWithOfflineFallback(
      sessionId,
      4500,
      "15151515-1515-4151-8151-151515151515",
    );

    const item = await getOutboxStore().get(
      businessId,
      (result as { mode: "offline"; id: string }).id,
    );
    expect(item?.operation).toBe("close");
    expect(item?.dependsOn).toEqual([sessionId]);
    expect((await getLocalDb().cashSessions.get(sessionId))?.closingCount).toBe(4500);
  });

  it("D5: closes online with the synced remote id after an offline open", async () => {
    api.cash.open.mockRejectedValue(new NetworkError("offline"));
    const opened = await openCashWithOfflineFallback(5000, "41414141-4141-4141-8414-414141414141");
    const localId = (opened as { mode: "offline"; id: string }).id;
    const remoteId = "42424242-4242-4242-8424-424242424242";
    const outbox = getOutboxStore();
    await outbox.markInFlight(businessId, localId);
    await outbox.markSynced(businessId, localId, remoteId);
    api.cash.close.mockResolvedValue({
      id: remoteId,
      localDate: "2026-09-20",
      openedAt: 1000,
      closedAt: 2000,
      openingFloat: 5000,
      closingCount: 4800,
      expectedEfectivo: 5000,
      expectedNequi: 0,
      difference: -200,
    });

    const result = await closeCashWithOfflineFallback(
      localId,
      4800,
      "43434343-4343-4343-8434-434343434343",
    );

    expect(result.mode).toBe("online");
    expect(api.cash.close).toHaveBeenCalledWith(
      remoteId,
      4800,
      "43434343-4343-4343-8434-434343434343",
    );
    expect((await getLocalDb().cashSessions.get(localId))?.closingCount).toBe(4800);
  });

  it("D5: queues the close offline while its open is still unsynced", async () => {
    api.cash.open.mockRejectedValue(new NetworkError("offline"));
    const opened = await openCashWithOfflineFallback(5000, "44444444-4444-4444-8444-444444444444");
    const localId = (opened as { mode: "offline"; id: string }).id;
    api.cash.close.mockResolvedValue({
      id: "45454545-4545-4454-8454-454545454545",
      closedAt: 2000,
      closingCount: 4800,
      expectedEfectivo: 5000,
      expectedNequi: 0,
      difference: -200,
    });

    const result = await closeCashWithOfflineFallback(
      localId,
      4800,
      "46464646-4646-4464-8464-464646464646",
    );

    expect(result.mode).toBe("offline");
    expect(api.cash.close).not.toHaveBeenCalled();
    const item = await getOutboxStore().get(
      businessId,
      (result as { mode: "offline"; id: string }).id,
    );
    expect(item?.dependsOn).toEqual([localId]);
  });

  it("D8: closes online a session unknown locally (opened on another device)", async () => {
    const remoteId = "51515151-5151-4515-8151-515151515151";
    api.cash.close.mockResolvedValue({
      id: remoteId,
      localDate: "2026-09-20",
      openedAt: 1000,
      closedAt: 2000,
      openingFloat: 0,
      closingCount: 1200,
      expectedEfectivo: 1000,
      expectedNequi: 0,
      difference: 200,
    });

    const result = await closeCashWithOfflineFallback(
      remoteId,
      1200,
      "52525252-5252-4525-8252-525252525252",
    );

    expect(result.mode).toBe("online");
    expect(api.cash.close).toHaveBeenCalledWith(
      remoteId,
      1200,
      "52525252-5252-4525-8252-525252525252",
    );
  });

  it("D8: still rejects a local row from another business", async () => {
    const foreignId = "53535353-5353-4535-8353-535353535353";
    await getLocalDb().cashSessions.put({
      id: foreignId,
      businessId: otherBusinessId,
      localDate: "2026-09-20",
      openedAt: 1000,
      closedAt: null,
      openingFloat: 0,
      closingCount: null,
      expectedEfectivo: null,
      expectedNequi: null,
      difference: null,
      note: null,
      createdAt: 1000,
      updatedAt: 1000,
    });
    api.cash.close.mockResolvedValue({
      id: foreignId,
      closedAt: 2000,
      closingCount: 0,
      expectedEfectivo: 0,
      expectedNequi: 0,
      difference: 0,
    });

    await expect(
      closeCashWithOfflineFallback(foreignId, 0, "54545454-5454-4545-8545-545454545454"),
    ).rejects.toThrow("no pertenece al negocio");
  });

  it("records offline aporte and retiro after an open cash session", async () => {
    api.cash.open.mockRejectedValue(new NetworkError("offline"));
    await openCashWithOfflineFallback(5000, "16161616-1616-4161-8161-161616161616");
    api.cash.aporte.mockRejectedValue(new NetworkError("offline"));
    api.cash.retiro.mockRejectedValue(new NetworkError("offline"));

    expect(
      (await recordAporteOffline(
        { amount: 1000, method: "Efectivo", note: "fondo" },
        "17171717-1717-4171-8171-171717171717",
      )).mode,
    ).toBe("offline");
    expect(
      (await recordRetiroOffline(
        { amount: 500, method: "Nequi" },
        "18181818-1818-4181-8181-181818181818",
      )).mode,
    ).toBe("offline");

    const moves = await getLocalDb().cashMoves.where("businessId").equals(businessId).toArray();
    expect(moves.map((m) => m.kind).sort()).toEqual(["aporte", "retiro"]);
  });

  it("records an offline expense atomically with its cash move", async () => {
    api.cash.open.mockRejectedValue(new NetworkError("offline"));
    await openCashWithOfflineFallback(5000, "19191919-1919-4191-8191-191919191919");
    api.cash.recordExpense.mockRejectedValue(new NetworkError("offline"));

    const result = await recordExpenseWithOfflineFallback(
      { amount: 1200, category: "transporte", method: "Efectivo", note: "bus" },
      "20202020-2020-4202-8202-202020202020",
    );

    const expenses = await getLocalDb().expenses.where("businessId").equals(businessId).toArray();
    const moves = await getLocalDb().cashMoves.where("businessId").equals(businessId).toArray();
    expect(result.mode).toBe("offline");
    expect(expenses).toHaveLength(1);
    expect(moves.some((m) => m.kind === "expense" && m.refId === expenses[0].id)).toBe(true);
  });

  it("surtir updates cached stock and records one outbox operation", async () => {
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await getLocalDb().products.put(productRow());

    const result = await surtirWithOfflineFallback(
      { productId, qty: 5, unitCost: 200, totalCost: 1000, method: "Efectivo", supplierId: null },
      "21212121-2121-4212-8212-212121212121",
    );
    const id = (result as { mode: "offline"; id: string }).id;

    expect((await getLocalDb().products.get(productId))?.stock).toBe(15);
    expect((await getLocalDb().products.get(productId))?.avgCost).toBe(133);
    expect((await getLocalDb().stockMoves.get(id))?.delta).toBe(5);
    expect((await getOutboxStore().get(businessId, id))?.requestId).toBe(
      "21212121-2121-4212-8212-212121212121",
    );
  });

  it("surtir on a combo adds totalCost to the lot pool instead of reweighting units", async () => {
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await getLocalDb().products.put({
      ...productRow(1, 50_000, false),
      name: "Combo enchiladas",
    });
    await surtirWithOfflineFallback(
      { productId, qty: 1, unitCost: 50_000, totalCost: 50_000, method: "Efectivo", supplierId: null },
      "21212121-2121-4212-8212-212121212122",
    );
    const combo = await getLocalDb().products.get(productId);
    expect(combo?.stock).toBe(2);
    expect(combo?.avgCost).toBe(100_000);
  });

  it("surtir waits for an offline supplier creation instead of referencing it", async () => {
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await getLocalDb().products.put(productRow());
    await getLocalDb().suppliers.put({
      id: supplierId,
      businessId,
      name: "Proveedor",
      phone: null,
      notes: null,
      requestId: "22222222-2222-4222-8222-222222222222",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await getOutboxStore().enqueue({
      operationId: "23232323-2323-4232-8232-232323232323",
      businessId,
      entity: "supplier",
      operation: "create",
      requestId: "22222222-2222-4222-8222-222222222222",
      payload: { name: "Proveedor" },
      dependsOn: [],
    });

    await expect(
      surtirWithOfflineFallback(
        { productId, qty: 1, unitCost: 100, totalCost: 100, method: "Efectivo", supplierId },
        "24242424-2424-4242-8242-242424242424",
      ),
    ).rejects.toThrow("aún se está sincronizando");
    expect(await getLocalDb().stockMoves.where("businessId").equals(businessId).count()).toBe(0);
  });

  it("rejects shrink when cached stock is insufficient", async () => {
    api.inventory.shrink.mockRejectedValue(new NetworkError("offline"));
    await getLocalDb().products.put(productRow(2, 120));
    await expect(
      shrinkWithOfflineFallback(
        { productId, qty: 3, reason: "perdido" },
        "32323232-3232-4232-8232-323232323232",
      ),
    ).rejects.toThrow("Stock insuficiente.");
    expect(await getLocalDb().stockMoves.where("businessId").equals(businessId).count()).toBe(0);
    expect(await getLocalDb().outbox.where("businessId").equals(businessId).count()).toBe(0);
  });

  it("rejects inventory writes for archived products", async () => {
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await getLocalDb().products.put({ ...productRow(), archivedAt: "2026-09-20T00:00:00.000Z" });
    await expect(
      surtirWithOfflineFallback(
        { productId, qty: 1, unitCost: 100, totalCost: 100, method: "Efectivo" },
        "33333333-3333-4333-8333-333333333333",
      ),
    ).rejects.toThrow("El producto está archivado.");
  });

  it("syncs an offline expense with the same requestId", async () => {
    api.cash.recordExpense.mockRejectedValueOnce(new NetworkError("offline"));
    const requestId = "34343434-3434-4343-8343-343434343434";
    const local = await recordExpenseWithOfflineFallback(
      { amount: 1200, category: "transporte", method: "Efectivo" },
      requestId,
    );
    expect(local.mode).toBe("offline");
    api.cash.recordExpense.mockResolvedValueOnce({
      id: "35353535-3535-4353-8353-353535353535",
      amount: 1200,
      category: "transporte",
      method: "Efectivo",
      note: null,
      occurredOn: "2026-09-20",
      createdAt: Date.now(),
    });
    await syncPendingOperations(businessId);
    expect(api.cash.recordExpense).toHaveBeenLastCalledWith(
      { amount: 1200, category: "transporte", method: "Efectivo", note: undefined },
      requestId,
    );
    expect((await getOutboxStore().get(businessId, (local as {mode:"offline";id:string}).id))?.status).toBe("synced");
  });

  it("syncs an offline surtida with the same requestId", async () => {
    api.inventory.surtir.mockRejectedValueOnce(new NetworkError("offline"));
    await getLocalDb().products.put(productRow());
    const requestId = "36363636-3636-4363-8363-363636363636";
    const local = await surtirWithOfflineFallback(
      { productId, qty: 2, unitCost: 100, totalCost: 200, method: "Efectivo" },
      requestId,
    );
    expect(local.mode).toBe("offline");
    api.inventory.surtir.mockResolvedValueOnce({
      id: "37373737-3737-4373-8373-373737373737",
      productId,
      delta: 2,
      reason: "surtir",
      unitCost: 100,
      supplierId: null,
      note: null,
      occurredOn: "2026-09-20",
      createdAt: Date.now(),
    });
    await syncPendingOperations(businessId);
    expect(api.inventory.surtir).toHaveBeenLastCalledWith(
      productId,
      { productId, qty: 2, unitCost: 100, totalCost: 200, method: "Efectivo" },
      requestId,
    );
    expect((await getOutboxStore().get(businessId, (local as {mode:"offline";id:string}).id))?.status).toBe("synced");
  });

  it("shrink updates cached stock and queues one operation", async () => {
    api.inventory.shrink.mockRejectedValue(new NetworkError("offline"));
    await getLocalDb().products.put(productRow(8, 120));

    const result = await shrinkWithOfflineFallback(
      { productId, qty: 3, reason: "perdido", note: "dañado" },
      "25252525-2525-4252-8252-252525252525",
    );
    const id = (result as { mode: "offline"; id: string }).id;

    expect((await getLocalDb().products.get(productId))?.stock).toBe(5);
    expect((await getLocalDb().stockMoves.get(id))?.reason).toBe("perdido");
  });

  it.each([401, 403, 500])("does not fallback for HTTP %s", async (status) => {
    api.cash.aporte.mockRejectedValue(Object.assign(new Error("server"), { status }));

    await expect(
      recordAporteOffline(
        { amount: 100, method: "Efectivo" },
        "26262626-2626-4262-8262-262626262626",
      ),
    ).rejects.toThrow("server");

    expect(await getLocalDb().cashMoves.where("businessId").equals(businessId).count()).toBe(0);
    expect(await getLocalDb().outbox.where("businessId").equals(businessId).count()).toBe(0);
  });

  it("syncs an offline open before an offline close and uses the remote session id", async () => {
    api.cash.open.mockRejectedValueOnce(new NetworkError("offline")).mockResolvedValueOnce({
      id: "27272727-2727-4272-8272-272727272727",
      localDate: "2026-09-20",
      openedAt: Date.now(),
      closedAt: null,
      openingFloat: 5000,
      closingCount: null,
      expectedEfectivo: null,
      expectedNequi: null,
      difference: null,
    });

    const opened = await openCashWithOfflineFallback(5000, "28282828-2828-4282-8282-282828282828");
    const localSessionId = (opened as { mode: "offline"; id: string }).id;
    await syncPendingOperations(businessId);

    api.cash.close.mockRejectedValueOnce(new NetworkError("offline")).mockResolvedValueOnce({
      id: "29292929-2929-4292-8292-292929292929",
      localDate: "2026-09-20",
      openedAt: Date.now(),
      closedAt: Date.now(),
      openingFloat: 5000,
      closingCount: 4800,
      expectedEfectivo: 5000,
      expectedNequi: 0,
      difference: -200,
    });

    await closeCashWithOfflineFallback(localSessionId, 4800, "30303030-3030-4303-8303-303030303030");
    await syncPendingOperations(businessId);

    expect(api.cash.close).toHaveBeenLastCalledWith(
      "27272727-2727-4272-8272-272727272727",
      4800,
      "30303030-3030-4303-8303-303030303030",
    );
  });

  it("keeps another tenant out of local cash operations", async () => {
    await getLocalDb().cashMoves.put({
      id: "31313131-3131-4313-8313-313131313131",
      businessId: otherBusinessId,
      amount: 999,
      direction: "in",
      method: "Efectivo",
      kind: "aporte",
      sessionId: null,
      refType: null,
      refId: null,
      requestId: null,
      note: null,
      occurredOn: "2026-09-20",
      createdAt: Date.now(),
    });

    expect(await getLocalDb().cashMoves.where("businessId").equals(businessId).count()).toBe(0);
  });
});
