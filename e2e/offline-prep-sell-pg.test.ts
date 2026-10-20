/**
 * loop-v1 HIGH follow-up: offline PREPARE 3 → SELL 2 of them → shrink 1, then
 * one reconnect sync against the REAL Nest backend + embedded PostgreSQL
 * (sales/shrinks enforce `stock >= qty`). Same harness as offline-client-pg.
 *
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
import { prepararWithOfflineFallback } from "@/data/pwa/offline-production";
import { openCashWithOfflineFallback, shrinkWithOfflineFallback } from "@/data/pwa/offline-operations";
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

describe("offline prepare → sell → shrink, synced to PostgreSQL", () => {
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


  it("prepared units are on the server before the sale and the shrink use them", async () => {
    await freshDexie();
    applySession();
    offline = false;
    const insumo = await createProductWithOfflineFallback(
      { name: "Insumo combo", price: 0, stock: 5, avgCost: 1_000, sellable: false },
      newEntityId(),
    );
    const combo = await createProductWithOfflineFallback(
      { name: "Combo enchiladas", price: 6_000, stock: 0, avgCost: 0 },
      newEntityId(),
    );
    if (insumo.mode !== "online" || combo.mode !== "online") throw new Error("products should be online");
    await listCachedProducts();
    const insumoId = insumo.product.id;
    const comboId = combo.product.id;

    offline = true;
    const opened = await openCashWithOfflineFallback(10_000, newEntityId());
    expect(opened.mode).toBe("offline");
    const prep = await prepararWithOfflineFallback(
      { sourceId: insumoId, targetId: comboId, qty: 3, unitCost: 1_000 },
      newEntityId(),
    );
    expect(prep.mode).toBe("offline");
    const sale = await createSaleWithOfflineFallback(
      { lines: [{ productId: comboId, qty: 2 }], paymentKind: "paid", amountReceived: 12_000, method: "Efectivo" },
      newEntityId(),
    );
    expect(sale.mode).toBe("offline");
    const shrink = await shrinkWithOfflineFallback({ productId: comboId, qty: 1, reason: "perdido" }, newEntityId());
    expect((shrink as { mode: string }).mode).toBe("offline");
    expect((await getLocalDb().products.get(comboId))?.stock).toBe(0);
    const queued = (await getLocalDb().outbox.where("businessId").equals(biz).toArray())
      .sort((a, b) => a.localCreatedAt - b.localCreatedAt)
      .map((o) => `${o.entity}:${o.operation}`);

    offline = false;
    const from = attempts.length;
    await syncAllPending(biz);
    const posts = attempts.slice(from).filter((a) => !a.blocked && a.method === "POST").map((a) => new URL(a.url).pathname);
    const rows = await getLocalDb().outbox.where("businessId").equals(biz).toArray();
    const notSynced = rows.filter((o) => o.status !== "synced").map((o) => `${o.entity}:${o.operation}=${o.status} ${o.lastError ?? ""}`);
    const p = prisma as unknown as {
      product: { findFirst(a: unknown): Promise<{ stock: number } | null> };
      sale: { count(a: unknown): Promise<number> };
      cashMove: { findMany(a: unknown): Promise<Array<{ amount: bigint; direction: string; kind: string; method: string }>> };
    };
    const serverCombo = await p.product.findFirst({ where: { id: comboId } });
    const serverInsumo = await p.product.findFirst({ where: { id: insumoId } });
    const sales = await p.sale.count({ where: { businessId: biz } });
    const cash = await p.cashMove.findMany({ where: { businessId: biz } });
    console.log("PREP-SELL", JSON.stringify({ queued, posts, notSynced, serverComboStock: serverCombo?.stock, serverInsumoStock: serverInsumo?.stock, sales, cash: cash.map((m) => `${m.kind}:${m.direction}:${m.method}:${m.amount}`) }));

    expect(notSynced, "every queued op reaches the server in the reconnect sync").toEqual([]);
    expect(serverInsumo?.stock).toBe(5); // the source lot is not decremented by design (catalog.service createPreparation)
    expect(serverCombo?.stock).toBe(0); // 0 + 3 prepared - 2 sold - 1 merma
    expect(sales).toBe(1);
    // Cash: the paid sale is the only Efectivo "in" move (preparations move no cash).
    expect(cash.filter((m) => m.direction === "in" && m.method === "Efectivo").reduce((s, m) => s + Number(m.amount), 0)).toBe(12_000);
  });
});
