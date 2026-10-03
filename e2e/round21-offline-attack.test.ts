/**
 * Round 2.1 — try to break the production outbox against a real Nest
 * process and PostgreSQL. The response drop waits until the server has
 * finished the HTTP call (the transaction committed) and then throws,
 * so the client sees a network failure.
 */
import "fake-indexeddb/auto";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetPwaApi } from "@/data/pwa/api";
import { listCachedCustomers, listCachedProducts } from "@/data/pwa/catalog";
import { createCustomerWithOfflineFallback } from "@/data/pwa/offline-catalog";
import { createInitialDebtWithOfflineFallback } from "@/data/pwa/offline-initial-debt";
import { createPaymentWithOfflineFallback } from "@/data/pwa/offline-payments";
import { createProductWithOfflineFallback } from "@/data/pwa/offline-catalog";
import { createSaleWithOfflineFallback } from "@/data/pwa/offline-sales";
import { syncAllPending } from "@/data/pwa/sync-coordinator";
import { getPwaAuthSession, resetPwaAuthSessionForTests } from "@/data/http/session";
import { __reopenLocalDbForTests, __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { resetLocalStoreSingleton } from "@/data/local/store";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";

type Ready = {
  baseUrl: string;
  databaseUrl: string;
  owner: {
    accessToken: string;
    refreshToken: string;
    userId: string;
    email: string;
    businessId: string;
  };
};

type Countable = {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findFirst(args: { where: Record<string, unknown> }): Promise<{
    id: string;
    debt?: bigint;
    stock?: number;
    amount?: bigint;
  } | null>;
};

type PrismaLike = {
  $disconnect(): Promise<void>;
  customer: Countable;
  product: Countable;
  sale: Countable;
  initialDebt: Countable;
  customerPayment: Countable;
  cashMove: Countable;
};

const nativeFetch = globalThis.fetch.bind(globalThis);
let offline = false;
let dropPost: ((url: string) => boolean) | null = null;
let holdSale: { gate: Promise<void>; open: () => void } | null = null;
let dropped = 0;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (
    init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
  ).toUpperCase();
  if (offline) throw new TypeError("Failed to fetch");
  const response = await nativeFetch(input, init);
  if (holdSale && method === "POST" && url.includes("/sales")) {
    const gate = holdSale;
    holdSale = null;
    await gate.gate;
    dropped += 1;
    throw new TypeError("Failed to fetch");
  }
  if (dropPost && method === "POST" && dropPost(url)) {
    dropPost = null;
    dropped += 1;
    throw new TypeError("Failed to fetch");
  }
  return response;
};

const repoRoot = path.resolve(__dirname, "..");
const backendRequire = createRequire(path.join(repoRoot, "backend", "package.json"));
const { PrismaClient } = backendRequire("@prisma/client") as {
  PrismaClient: new (args?: { datasources?: { db?: { url?: string } } }) => PrismaLike;
};

let server: ChildProcess | null = null;
let serverLog = "";
let prisma: PrismaLike;
let ready: Ready;
let biz = "";

function reopen(): void {
  resetOutboxStoreSingleton();
  resetOutboxSyncEngineSingleton();
  resetLocalStoreSingleton();
  resetCatalogReadCache();
  resetPwaApi();
  __reopenLocalDbForTests();
}

async function freshDexie(): Promise<void> {
  resetOutboxStoreSingleton();
  resetOutboxSyncEngineSingleton();
  resetLocalStoreSingleton();
  resetCatalogReadCache();
  resetPwaApi();
  await __resetLocalDbForTests();
}

function applySession(): void {
  resetPwaAuthSessionForTests();
  const session = getPwaAuthSession();
  session.accessToken = ready.owner.accessToken;
  session.refreshToken = ready.owner.refreshToken;
  session.user = { id: ready.owner.userId, email: ready.owner.email };
  session.selectBusiness(ready.owner.businessId);
  resetPwaApi();
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 8000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("round 2.1 offline attacks against PostgreSQL", () => {
  beforeAll(async () => {
    const readyFile = path.join("/tmp", `dc-r21-${process.pid}.json`);
    fs.rmSync(readyFile, { force: true });
    const env = { ...process.env };
    delete env.DATABASE_URL;
    env.JWT_SECRET = "test-access-secret";
    env.JWT_REFRESH_SECRET = "test-refresh-secret";
    env.DISABLE_THROTTLE = "1";
    env.NODE_ENV = "test";
    server = spawn(
      process.execPath,
      ["-r", "./test/register-ts.cjs", "./test/listen-client-pg.ts", readyFile],
      { cwd: path.join(repoRoot, "backend"), env, stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stdout?.on("data", (chunk: Buffer) => {
      serverLog = `${serverLog}${chunk.toString()}`.slice(-20000);
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      serverLog = `${serverLog}${chunk.toString()}`.slice(-20000);
    });
    const started = Date.now();
    let exited: number | null = null;
    server.once("exit", (code) => {
      exited = code;
    });
    while (!fs.existsSync(readyFile)) {
      if (exited !== null) throw new Error(`server exited ${exited}\n${serverLog}`);
      if (Date.now() - started > 90000) throw new Error(`server not ready\n${serverLog}`);
      await wait(200);
    }
    ready = JSON.parse(fs.readFileSync(readyFile, "utf8")) as Ready;
    biz = ready.owner.businessId;
    process.env.NEXT_PUBLIC_API_URL = ready.baseUrl;
    prisma = new PrismaClient({ datasources: { db: { url: ready.databaseUrl } } });
    applySession();
    await freshDexie();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (server) await stopServer(server);
  });

  async function onlineShelf(name: string, stock: number) {
    offline = false;
    dropPost = null;
    const customer = await createCustomerWithOfflineFallback({ name }, newEntityId());
    if (customer.mode !== "online") throw new Error("customer should be online");
    const product = await createProductWithOfflineFallback(
      { name: `Prod ${name}`, price: 1_000, stock, avgCost: 100 },
      newEntityId(),
    );
    if (product.mode !== "online") throw new Error("product should be online");
    await listCachedCustomers();
    await listCachedProducts();
    return { customerId: customer.customer.id, productId: product.product.id };
  }

  it("drops the sale response after commit and the retry writes one row", async () => {
    await freshDexie();
    applySession();
    const shelf = await onlineShelf("Ana Drop", 10);
    const saleKey = newEntityId();
    offline = true;
    const sale = await createSaleWithOfflineFallback(
      {
        lines: [{ productId: shelf.productId, qty: 4 }],
        paymentKind: "credit",
        customerId: shelf.customerId,
        amountReceived: 0,
      },
      saleKey,
    );
    if (sale.mode !== "offline") throw new Error("sale should be offline");
    reopen();
    offline = false;
    const before = dropped;
    dropPost = (url) => url.includes("/sales");
    const first = await syncAllPending(biz);
    expect(dropped).toBe(before + 1);
    expect(first.sales.failed).toBe(1);
    expect(first.sales.synced).toBe(0);
    expect((await getLocalDb().outbox.get(sale.saleId))?.status).toBe("failed");
    expect(await prisma.sale.count({ where: { businessId: biz, requestId: saleKey } })).toBe(1);
    expect((await prisma.product.findFirst({ where: { id: shelf.productId } }))?.stock).toBe(6);
    expect(Number((await prisma.customer.findFirst({ where: { id: shelf.customerId } }))?.debt)).toBe(4_000);
    expect((await getLocalDb().products.get(shelf.productId))?.stock).toBe(6);

    await wait(1_500);
    const second = await syncAllPending(biz);
    expect(second.sales.synced).toBe(1);
    expect((await getLocalDb().outbox.get(sale.saleId))?.status).toBe("synced");
    expect(await prisma.sale.count({ where: { businessId: biz, requestId: saleKey } })).toBe(1);
    expect((await prisma.product.findFirst({ where: { id: shelf.productId } }))?.stock).toBe(6);
    expect(Number((await prisma.customer.findFirst({ where: { id: shelf.customerId } }))?.debt)).toBe(4_000);
    expect((await getLocalDb().products.get(shelf.productId))?.stock).toBe(6);
    expect((await getLocalDb().customers.get(shelf.customerId))?.debt).toBe(4_000);
  });

  it("drops the payment response after commit and retries once", async () => {
    await freshDexie();
    applySession();
    const shelf = await onlineShelf("Beto Drop", 5);
    offline = false;
    const debt = await createInitialDebtWithOfflineFallback(
      { customerId: shelf.customerId, amount: 5_000 },
      newEntityId(),
    );
    if (debt.mode !== "online") throw new Error("debt should be online");
    const localCustomer = await getLocalDb().customers.get(shelf.customerId);
    if (!localCustomer) throw new Error("local customer missing");
    await getLocalDb().customers.put({ ...localCustomer, debt: 5_000 });
    const payKey = newEntityId();
    offline = true;
    const payment = await createPaymentWithOfflineFallback(
      { customerId: shelf.customerId, amount: 2_000, method: "Efectivo" },
      payKey,
    );
    if (payment.mode !== "offline") throw new Error("payment should be offline");
    reopen();
    offline = false;
    dropPost = (url) => url.includes("/payments");
    const first = await syncAllPending(biz);
    expect(first.payments.failed).toBe(1);
    expect(await prisma.customerPayment.count({ where: { businessId: biz, requestId: payKey } })).toBe(1);
    expect(Number((await prisma.customer.findFirst({ where: { id: shelf.customerId } }))?.debt)).toBe(3_000);
    expect(await prisma.cashMove.count({ where: { businessId: biz, kind: "debt_collect" } })).toBe(1);

    await wait(1_500);
    const second = await syncAllPending(biz);
    expect(second.payments.synced).toBe(1);
    expect(await prisma.customerPayment.count({ where: { requestId: payKey } })).toBe(1);
    expect(Number((await prisma.customer.findFirst({ where: { id: shelf.customerId } }))?.debt)).toBe(3_000);
    expect(await prisma.cashMove.count({ where: { businessId: biz, kind: "debt_collect" } })).toBe(1);
    expect((await getLocalDb().customers.get(shelf.customerId))?.debt).toBe(3_000);
  });

  it("recovers an in_flight sale on the next open and does not double it", async () => {
    await freshDexie();
    applySession();
    const shelf = await onlineShelf("InFlight", 8);
    const saleKey = newEntityId();
    offline = true;
    const sale = await createSaleWithOfflineFallback(
      {
        lines: [{ productId: shelf.productId, qty: 1 }],
        paymentKind: "credit",
        customerId: shelf.customerId,
        amountReceived: 0,
      },
      saleKey,
    );
    if (sale.mode !== "offline") throw new Error("sale should be offline");
    await getOutboxStore().markInFlight(biz, sale.saleId);
    expect((await getLocalDb().outbox.get(sale.saleId))?.status).toBe("in_flight");
    reopen();
    offline = false;
    const synced = await syncAllPending(biz);
    expect(synced.sales).toMatchObject({ synced: 1, failed: 0 });
    expect(await prisma.sale.count({ where: { businessId: biz, requestId: saleKey } })).toBe(1);
    expect((await prisma.product.findFirst({ where: { id: shelf.productId } }))?.stock).toBe(7);
    expect((await getLocalDb().outbox.get(sale.saleId))?.status).toBe("synced");
  });

  it("two engines overlapping one sale still leave a single PostgreSQL row", async () => {
    await freshDexie();
    applySession();
    const shelf = await onlineShelf("Dos Motores", 10);
    const saleKey = newEntityId();
    offline = true;
    const sale = await createSaleWithOfflineFallback(
      {
        lines: [{ productId: shelf.productId, qty: 2 }],
        paymentKind: "credit",
        customerId: shelf.customerId,
        amountReceived: 0,
      },
      saleKey,
    );
    if (sale.mode !== "offline") throw new Error("sale should be offline");
    reopen();
    offline = false;
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    holdSale = { gate, open: openGate };
    const first = syncAllPending(biz);
    const seen = Date.now();
    while ((await getLocalDb().outbox.get(sale.saleId))?.status !== "in_flight") {
      if (Date.now() - seen > 10000) throw new Error("sale never went in_flight");
      await wait(20);
    }
    resetOutboxSyncEngineSingleton();
    const second = await syncAllPending(biz);
    openGate();
    const firstOutcome = await first.then(
      (value) => value,
      (error: unknown) => error,
    );
    expect(second.sales.synced).toBe(1);
    expect(await prisma.sale.count({ where: { businessId: biz, requestId: saleKey } })).toBe(1);
    expect((await prisma.product.findFirst({ where: { id: shelf.productId } }))?.stock).toBe(8);
    expect(Number((await prisma.customer.findFirst({ where: { id: shelf.customerId } }))?.debt)).toBe(2_000);
    expect((await getLocalDb().outbox.get(sale.saleId))?.status).toBe("synced");
    expect(firstOutcome instanceof Error).toBe(false);
  });

  it("a 401 puts the sale back to pending and does not write it", async () => {
    await freshDexie();
    applySession();
    const shelf = await onlineShelf("Sin Sesion", 4);
    const saleKey = newEntityId();
    offline = true;
    const sale = await createSaleWithOfflineFallback(
      {
        lines: [{ productId: shelf.productId, qty: 1 }],
        paymentKind: "credit",
        customerId: shelf.customerId,
        amountReceived: 0,
      },
      saleKey,
    );
    if (sale.mode !== "offline") throw new Error("sale should be offline");
    reopen();
    const session = getPwaAuthSession();
    session.accessToken = "not-a-jwt";
    session.refreshToken = "not-a-jwt";
    resetPwaApi();
    offline = false;
    const blocked = await syncAllPending(biz);
    expect(blocked.sales.authRequired).toBe(true);
    expect(blocked.sales.synced).toBe(0);
    expect((await getLocalDb().outbox.get(sale.saleId))?.status).toBe("pending");
    expect(await prisma.sale.count({ where: { requestId: saleKey } })).toBe(0);
    expect((await getLocalDb().products.get(shelf.productId))?.stock).toBe(3);

    applySession();
    const synced = await syncAllPending(biz);
    expect(synced.sales.synced).toBe(1);
    expect(await prisma.sale.count({ where: { requestId: saleKey } })).toBe(1);
    expect((await prisma.product.findFirst({ where: { id: shelf.productId } }))?.stock).toBe(3);
  });

  it("a 409 oversell is permanent, reverts the local stock, and writes nothing", async () => {
    await freshDexie();
    applySession();
    const shelf = await onlineShelf("Oversell", 5);
    await prisma.product.update({
      where: { id: shelf.productId },
      data: { stock: 1 },
    });
    const saleKey = newEntityId();
    offline = true;
    const sale = await createSaleWithOfflineFallback(
      {
        lines: [{ productId: shelf.productId, qty: 5 }],
        paymentKind: "credit",
        customerId: shelf.customerId,
        amountReceived: 0,
      },
      saleKey,
    );
    if (sale.mode !== "offline") throw new Error("sale should be offline");
    expect((await getLocalDb().products.get(shelf.productId))?.stock).toBe(0);
    reopen();
    offline = false;
    const synced = await syncAllPending(biz);
    expect(synced.sales.failed).toBe(1);
    expect(synced.sales.synced).toBe(0);
    const row = await getLocalDb().outbox.get(sale.saleId);
    expect(row?.status).toBe("failed");
    expect(row?.nextAttemptAt).toBeNull();
    expect(await prisma.sale.count({ where: { requestId: saleKey } })).toBe(0);
    expect((await prisma.product.findFirst({ where: { id: shelf.productId } }))?.stock).toBe(1);
    expect((await getLocalDb().products.get(shelf.productId))?.stock).toBe(5);

    await wait(1_500);
    const again = await syncAllPending(biz);
    expect(again.sales.synced).toBe(0);
    expect(again.sales.processed).toBe(0);
    expect(await prisma.sale.count({ where: { requestId: saleKey } })).toBe(0);
  });

  it("a rejected parent leaves the dependent debt pending and unsent", async () => {
    await freshDexie();
    applySession();
    offline = true;
    const customerKey = newEntityId();
    const created = await createCustomerWithOfflineFallback({ name: "Padre" }, customerKey);
    if (created.mode !== "offline") throw new Error("customer should be offline");
    const debt = await createInitialDebtWithOfflineFallback(
      { customerId: created.customerId, amount: 8_000 },
      newEntityId(),
    );
    if (debt.mode !== "offline") throw new Error("debt should be offline");
    const parent = await getOutboxStore().getByRequestId(biz, customerKey);
    if (!parent) throw new Error("parent missing");
    await getLocalDb().outbox.put({
      ...parent,
      payload: { ...(parent.payload as Record<string, unknown>), name: "" },
    });
    reopen();
    offline = false;
    const synced = await syncAllPending(biz);
    expect(synced.customers.failed).toBe(1);
    expect(synced.initialDebts.synced).toBe(0);
    expect(synced.initialDebts.blocked).toBeGreaterThan(0);
    expect((await getLocalDb().outbox.get(debt.debtId))?.status).toBe("pending");
    expect(await prisma.customer.count({ where: { businessId: biz, requestId: customerKey } })).toBe(0);
    expect(await prisma.initialDebt.count({ where: { businessId: biz, customerId: created.customerId } })).toBe(0);
  });

  it("a dependency cycle stays pending and writes nothing", async () => {
    await freshDexie();
    applySession();
    offline = true;
    const keyA = newEntityId();
    const keyB = newEntityId();
    const first = await createCustomerWithOfflineFallback({ name: "Ciclo A" }, keyA);
    const second = await createCustomerWithOfflineFallback({ name: "Ciclo B" }, keyB);
    if (first.mode !== "offline" || second.mode !== "offline") throw new Error("expected offline");
    const opA = await getOutboxStore().getByRequestId(biz, keyA);
    const opB = await getOutboxStore().getByRequestId(biz, keyB);
    if (!opA || !opB) throw new Error("ops missing");
    await getLocalDb().outbox.put({ ...opA, dependsOn: [opB.operationId] });
    await getLocalDb().outbox.put({ ...opB, dependsOn: [opA.operationId] });
    reopen();
    offline = false;
    const synced = await syncAllPending(biz);
    expect(synced.customers.synced).toBe(0);
    expect(synced.customers.blocked).toBe(2);
    expect((await getOutboxStore().getByRequestId(biz, keyA))?.status).toBe("pending");
    expect((await getOutboxStore().getByRequestId(biz, keyB))?.status).toBe("pending");
    expect(await prisma.customer.count({ where: { businessId: biz, requestId: keyA } })).toBe(0);
    expect(await prisma.customer.count({ where: { businessId: biz, requestId: keyB } })).toBe(0);
  });
});
