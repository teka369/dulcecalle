/**
 * Client data layer → Dexie → outbox → reload → real HTTP → PostgreSQL.
 * IndexedDB is fake-indexeddb (no browser). Dexie, the outbox, the sync
 * coordinator and HttpClient are the production modules. Fetch is blocked
 * at the process border to force the offline fallback, then released.
 * Nest listens on a real port. Final asserts read PostgreSQL through Prisma.
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
import { createReturnWithOfflineFallback } from "@/data/pwa/offline-returns";
import { createSaleWithOfflineFallback } from "@/data/pwa/offline-sales";
import { getStatementWithOfflineFallback } from "@/data/pwa/offline-statement";
import { syncAllPending } from "@/data/pwa/sync-coordinator";
import { getPwaAuthSession, resetPwaAuthSessionForTests } from "@/data/http/session";
import { __reopenLocalDbForTests, __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { getOutboxStore, resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";

type Attempt = { url: string; method: string; blocked: boolean };
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
  otherBusinessId: string;
};
type CustomerRow = { id: string; businessId: string; debt: bigint; requestId: string | null };
type ProductRow = { id: string; businessId: string; stock: number; requestId: string | null };
type SaleRow = {
  id: string;
  businessId: string;
  customerId: string | null;
  credit: bigint;
  amountReceived: bigint;
  requestId: string | null;
};
type DebtRow = { id: string; businessId: string; customerId: string; amount: bigint; requestId: string | null };
type PaymentRow = { id: string; businessId: string; customerId: string; amount: bigint; requestId: string | null };
type ReturnRow = {
  id: string;
  businessId: string;
  refundAmount: bigint;
  debtReduced: bigint;
  requestId: string | null;
};
type CashRow = { businessId: string; amount: bigint; direction: string; kind: string };
type PrismaLike = {
  $disconnect(): Promise<void>;
  customer: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    findFirst(args: { where: Record<string, unknown> }): Promise<CustomerRow | null>;
  };
  initialDebt: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    findFirst(args: { where: Record<string, unknown> }): Promise<DebtRow | null>;
  };
  product: {
    findFirst(args: { where: Record<string, unknown> }): Promise<ProductRow | null>;
  };
  sale: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    findFirst(args: { where: Record<string, unknown> }): Promise<SaleRow | null>;
  };
  saleLine: { count(args: { where: Record<string, unknown> }): Promise<number> };
  customerPayment: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    findFirst(args: { where: Record<string, unknown> }): Promise<PaymentRow | null>;
  };
  saleReturn: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    findFirst(args: { where: Record<string, unknown> }): Promise<ReturnRow | null>;
  };
  cashMove: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    findMany(args: { where: Record<string, unknown> }): Promise<CashRow[]>;
  };
};

const attempts: Attempt[] = [];
let offline = false;
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  if (offline) {
    attempts.push({ url, method, blocked: true });
    throw new TypeError("Failed to fetch");
  }
  attempts.push({ url, method, blocked: false });
  return nativeFetch(input, init);
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
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 8000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

describe("client data layer to PostgreSQL", () => {
  beforeAll(async () => {
    const readyFile = path.join("/tmp", `dc-client-pg-${process.pid}.json`);
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
      {
      cwd: path.join(repoRoot, "backend"),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
      if (exited !== null) {
        throw new Error(`client-pg server exited ${exited}\n${serverLog}`);
      }
      if (Date.now() - started > 90000) {
        throw new Error(`client-pg server did not become ready\n${serverLog}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
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

  it("A: offline customer and initial debt survive reload and sync once", async () => {
    await freshDexie();
    applySession();
    const customerKey = newEntityId();
    const debtKey = newEntityId();
    offline = true;
    const created = await createCustomerWithOfflineFallback({ name: "Ana Offline" }, customerKey);
    if (created.mode !== "offline") throw new Error("customer should be offline");
    const debt = await createInitialDebtWithOfflineFallback(
      { customerId: created.customerId, amount: 20_000 },
      debtKey,
    );
    if (debt.mode !== "offline") throw new Error("debt should be offline");

    const customerOp = await getOutboxStore().getByRequestId(biz, customerKey);
    const debtOp = await getLocalDb().outbox.get(debt.debtId);
    expect(customerOp?.status).toBe("pending");
    expect(debtOp?.status).toBe("pending");
    expect(debtOp?.dependsOn).toEqual([customerOp?.operationId]);
    expect(await getLocalDb().customers.get(created.customerId)).toMatchObject({ debt: 20_000 });
    expect(await getLocalDb().initialDebts.get(debt.debtId)).toMatchObject({ amount: 20_000 });
    expect(attempts.some((row) => row.blocked && row.method === "POST" && row.url.endsWith("/customers"))).toBe(true);
    expect(attempts.some((row) => !row.blocked && row.method === "POST")).toBe(false);
    expect(await prisma.customer.count({ where: { businessId: biz } })).toBe(0);
    expect(await prisma.initialDebt.count({ where: { businessId: biz } })).toBe(0);

    reopen();
    expect(await getLocalDb().outbox.get(debt.debtId)).toMatchObject({
      status: "pending",
      dependsOn: [customerOp?.operationId],
    });
    expect((await getOutboxStore().getByRequestId(biz, customerKey))?.status).toBe("pending");

    const httpFrom = attempts.length;
    offline = false;
    const synced = await syncAllPending(biz);
    expect(synced.customers).toMatchObject({ synced: 1, failed: 0 });
    expect(synced.initialDebts).toMatchObject({ synced: 1, failed: 0 });

    const http = attempts.slice(httpFrom).filter((row) => !row.blocked && row.method === "POST");
    const customerPost = http.findIndex((row) => row.url.endsWith("/customers"));
    const debtPost = http.findIndex((row) => row.url.includes("/initial-debts"));
    expect(customerPost).toBeGreaterThanOrEqual(0);
    expect(debtPost).toBeGreaterThan(customerPost);

    const storedCustomer = await prisma.customer.findFirst({ where: { businessId: biz, requestId: customerKey } });
    const storedDebt = await prisma.initialDebt.findFirst({ where: { businessId: biz, requestId: debtKey } });
    expect(storedCustomer?.businessId).toBe(biz);
    expect(Number(storedCustomer?.debt)).toBe(20_000);
    expect(storedDebt?.customerId).toBe(storedCustomer?.id);
    expect(Number(storedDebt?.amount)).toBe(20_000);
    expect(http[debtPost]?.url).toContain(storedCustomer?.id ?? "missing");
    expect(http[debtPost]?.url).not.toContain(created.customerId);
    expect(await prisma.customer.count({ where: { businessId: biz, requestId: customerKey } })).toBe(1);
    expect(await prisma.initialDebt.count({ where: { businessId: biz, requestId: debtKey } })).toBe(1);
    expect(await prisma.customer.count({ where: { businessId: ready.otherBusinessId } })).toBe(0);
    expect((await getOutboxStore().getByRequestId(biz, customerKey))?.status).toBe("synced");
    expect((await getOutboxStore().getByRequestId(biz, customerKey))?.remoteId).toBe(storedCustomer?.id);
    expect((await getLocalDb().outbox.get(debt.debtId))?.status).toBe("synced");
    expect(await getLocalDb().customers.get(created.customerId)).toBeUndefined();
    expect((await getLocalDb().customers.get(storedCustomer?.id ?? ""))?.debt).toBe(20_000);

    const replayFrom = attempts.length;
    const again = await syncAllPending(biz);
    expect(again.customers.synced).toBe(0);
    expect(again.initialDebts.synced).toBe(0);
    expect(attempts.length).toBe(replayFrom);
    expect(await prisma.customer.count({ where: { businessId: biz } })).toBe(1);
    expect(await prisma.initialDebt.count({ where: { businessId: biz } })).toBe(1);
  });

  it("B: offline credit sale and payment sync once into PostgreSQL", async () => {
    await freshDexie();
    applySession();
    offline = false;
    const customerKey = newEntityId();
    const productKey = newEntityId();
    const created = await createCustomerWithOfflineFallback({ name: "Beto Fiado" }, customerKey);
    if (created.mode !== "online") throw new Error("customer should be online");
    const product = await createProductWithOfflineFallback(
      { name: "Gomitas fiado", price: 1_000, stock: 10, avgCost: 400 },
      productKey,
    );
    if (product.mode !== "online") throw new Error("product should be online");
    await listCachedCustomers();
    await listCachedProducts();
    const customerId = created.customer.id;
    const productId = product.product.id;

    const saleKey = newEntityId();
    offline = true;
    const sale = await createSaleWithOfflineFallback(
      {
        lines: [{ productId, qty: 4 }],
        paymentKind: "credit",
        customerId,
        amountReceived: 0,
      },
      saleKey,
    );
    if (sale.mode !== "offline") throw new Error("sale should be offline");
    expect(await getLocalDb().sales.get(sale.saleId)).toMatchObject({ credit: 4_000, customerId });
    expect(await getLocalDb().saleLines.where("[businessId+saleId]").equals([biz, sale.saleId]).count()).toBe(1);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(6);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(4_000);
    expect((await getLocalDb().outbox.get(sale.saleId))?.status).toBe("pending");
    expect(await prisma.sale.count({ where: { businessId: biz, requestId: saleKey } })).toBe(0);
    expect((await prisma.product.findFirst({ where: { id: productId } }))?.stock).toBe(10);

    reopen();
    expect((await getLocalDb().outbox.get(sale.saleId))?.status).toBe("pending");
    expect((await getLocalDb().products.get(productId))?.stock).toBe(6);

    offline = false;
    const synced = await syncAllPending(biz);
    expect(synced.sales).toMatchObject({ synced: 1, failed: 0 });
    const storedSale = await prisma.sale.findFirst({ where: { businessId: biz, requestId: saleKey } });
    expect(storedSale?.customerId).toBe(customerId);
    expect(Number(storedSale?.credit)).toBe(4_000);
    expect(Number(storedSale?.amountReceived)).toBe(0);
    expect(await prisma.saleLine.count({ where: { saleId: storedSale?.id } })).toBe(1);
    expect((await prisma.product.findFirst({ where: { id: productId } }))?.stock).toBe(6);
    expect(Number((await prisma.customer.findFirst({ where: { id: customerId } }))?.debt)).toBe(4_000);
    expect((await getLocalDb().outbox.get(sale.saleId))?.status).toBe("synced");
    expect((await getLocalDb().outbox.get(sale.saleId))?.remoteId).toBe(storedSale?.id);

    const replayFrom = attempts.length;
    await syncAllPending(biz);
    expect(attempts.length).toBe(replayFrom);
    expect(await prisma.sale.count({ where: { businessId: biz, requestId: saleKey } })).toBe(1);
    expect((await prisma.product.findFirst({ where: { id: productId } }))?.stock).toBe(6);

    const payKey = newEntityId();
    offline = true;
    const payment = await createPaymentWithOfflineFallback(
      { customerId, amount: 1_500, method: "Efectivo" },
      payKey,
    );
    if (payment.mode !== "offline") throw new Error("payment should be offline");
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(2_500);
    const localCash = await getLocalDb().cashMoves.where("businessId").equals(biz).toArray();
    expect(localCash.filter((row) => row.requestId === payKey && row.kind === "debt_collect")).toHaveLength(1);
    expect((await getLocalDb().outbox.get(payment.paymentId))?.status).toBe("pending");
    expect(await prisma.customerPayment.count({ where: { businessId: biz, requestId: payKey } })).toBe(0);
    expect(Number((await prisma.customer.findFirst({ where: { id: customerId } }))?.debt)).toBe(4_000);

    reopen();
    expect((await getLocalDb().outbox.get(payment.paymentId))?.status).toBe("pending");
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(2_500);

    offline = false;
    const paid = await syncAllPending(biz);
    expect(paid.payments).toMatchObject({ synced: 1, failed: 0 });
    const storedPay = await prisma.customerPayment.findFirst({ where: { businessId: biz, requestId: payKey } });
    expect(storedPay?.customerId).toBe(customerId);
    expect(Number(storedPay?.amount)).toBe(1_500);
    expect(Number((await prisma.customer.findFirst({ where: { id: customerId } }))?.debt)).toBe(2_500);
    const cash = await prisma.cashMove.findMany({
      where: { businessId: biz, kind: "debt_collect", direction: "in" },
    });
    expect(cash.filter((row) => Number(row.amount) === 1_500)).toHaveLength(1);
    expect(await prisma.customerPayment.count({ where: { businessId: ready.otherBusinessId } })).toBe(0);
    expect(await prisma.sale.count({ where: { businessId: ready.otherBusinessId } })).toBe(0);

    const second = attempts.length;
    await syncAllPending(biz);
    expect(attempts.length).toBe(second);
    expect(await prisma.customerPayment.count({ where: { requestId: payKey } })).toBe(1);
    expect(Number((await prisma.customer.findFirst({ where: { id: customerId } }))?.debt)).toBe(2_500);
  });

  it("C: offline credit return projects debtReduced and syncs it once", async () => {
    await freshDexie();
    applySession();
    offline = false;
    const customerKey = newEntityId();
    const productKey = newEntityId();
    const created = await createCustomerWithOfflineFallback({ name: "Clara Devolucion" }, customerKey);
    if (created.mode !== "online") throw new Error("customer should be online");
    const product = await createProductWithOfflineFallback(
      { name: "Gomitas devolucion", price: 1_000, stock: 10, avgCost: 400 },
      productKey,
    );
    if (product.mode !== "online") throw new Error("product should be online");
    await listCachedCustomers();
    await listCachedProducts();
    const customerId = created.customer.id;
    const productId = product.product.id;
    const saleKey = newEntityId();
    const sold = await createSaleWithOfflineFallback(
      {
        lines: [{ productId, qty: 4 }],
        paymentKind: "credit",
        customerId,
        amountReceived: 0,
      },
      saleKey,
    );
    if (sold.mode !== "online") throw new Error("sale should be online");
    await listCachedCustomers();
    await listCachedProducts();
    expect(await prisma.sale.count({ where: { businessId: biz, requestId: saleKey } })).toBe(1);
    expect(Number((await prisma.customer.findFirst({ where: { id: customerId } }))?.debt)).toBe(4_000);
    expect((await prisma.product.findFirst({ where: { id: productId } }))?.stock).toBe(6);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(4_000);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(6);
    const lineId = sold.sale.lines[0]?.id;
    if (!lineId) throw new Error("sale line missing");

    const returnKey = newEntityId();
    offline = true;
    const returned = await createReturnWithOfflineFallback(
      sold.sale.id,
      [{ saleLineId: lineId, qty: 2 }],
      returnKey,
    );
    if (returned.mode !== "offline") throw new Error("return should be offline");
    const returnOp = await getLocalDb().outbox.get(returned.operationId);
    expect(returnOp).toMatchObject({
      status: "pending",
      requestId: returnKey,
      payload: {
        saleRef: sold.sale.id,
        projectedDebtReduced: 2_000,
        projectedRefundAmount: 0,
      },
    });
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(2_000);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(6);
    const localMoves = await getLocalDb().stockMoves.where("businessId").equals(biz).toArray();
    expect(localMoves.filter((row) => row.requestId === returnKey)).toHaveLength(0);
    const localCash = await getLocalDb().cashMoves.where("businessId").equals(biz).toArray();
    expect(localCash.filter((row) => row.kind === "devolucion")).toHaveLength(0);
    expect(await prisma.saleReturn.count({ where: { requestId: returnKey } })).toBe(0);
    expect(Number((await prisma.customer.findFirst({ where: { id: customerId } }))?.debt)).toBe(4_000);
    expect((await prisma.product.findFirst({ where: { id: productId } }))?.stock).toBe(6);
    expect(await prisma.cashMove.count({ where: { businessId: biz, kind: "devolucion" } })).toBe(0);
    expect(attempts.some((row) => row.blocked && row.method === "POST" && row.url.includes("/returns"))).toBe(true);

    const pendingStatement = await getStatementWithOfflineFallback(customerId);
    expect(pendingStatement?.source).toBe("cache");
    expect(pendingStatement?.statement.total).toBe(2_000);
    const pendingReturn = pendingStatement?.statement.entries.find((entry) => entry.kind === "devolucion");
    expect(pendingReturn).toMatchObject({ amount: 2_000, pending: true });

    reopen();
    const reloaded = await getLocalDb().outbox.get(returned.operationId);
    expect(reloaded).toMatchObject({
      status: "pending",
      requestId: returnKey,
      payload: { projectedDebtReduced: 2_000, projectedRefundAmount: 0 },
    });
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(2_000);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(6);
    const reloadedStatement = await getStatementWithOfflineFallback(customerId);
    expect(reloadedStatement?.source).toBe("cache");
    expect(reloadedStatement?.statement.total).toBe(2_000);

    offline = false;
    const synced = await syncAllPending(biz);
    expect(synced.returns).toMatchObject({ synced: 1, failed: 0 });
    const stored = await prisma.saleReturn.findFirst({ where: { businessId: biz, requestId: returnKey } });
    expect(Number(stored?.debtReduced)).toBe(2_000);
    expect(Number(stored?.refundAmount)).toBe(0);
    expect(await prisma.saleReturn.count({ where: { requestId: returnKey } })).toBe(1);
    expect(Number((await prisma.customer.findFirst({ where: { id: customerId } }))?.debt)).toBe(2_000);
    expect((await prisma.product.findFirst({ where: { id: productId } }))?.stock).toBe(8);
    expect(await prisma.cashMove.count({ where: { businessId: biz, kind: "devolucion" } })).toBe(0);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(8);
    expect(await prisma.saleReturn.count({ where: { businessId: ready.otherBusinessId } })).toBe(0);

    const replayFrom = attempts.length;
    await syncAllPending(biz);
    expect(attempts.length).toBe(replayFrom);
    expect(await prisma.saleReturn.count({ where: { requestId: returnKey } })).toBe(1);
    expect(Number((await prisma.customer.findFirst({ where: { id: customerId } }))?.debt)).toBe(2_000);
    expect((await prisma.product.findFirst({ where: { id: productId } }))?.stock).toBe(8);
    expect(await prisma.cashMove.count({ where: { businessId: biz, kind: "devolucion" } })).toBe(0);
  });
});
