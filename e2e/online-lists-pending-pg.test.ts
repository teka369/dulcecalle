/**
 * loop/v1 Tester HIGH: products, customers and suppliers created offline
 * vanished from the online lists until their create synced. REAL Nest +
 * embedded PostgreSQL: create offline → online, sync NOT run → each list
 * shows its item once with the right count → sync → still exactly once,
 * count equals the server's.
 */
import "fake-indexeddb/auto";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetPwaApi } from "@/data/pwa/api";
import { listCachedCustomers, listCachedProducts, listCachedSuppliers } from "@/data/pwa/catalog";
import { createCustomerWithOfflineFallback, createSupplierWithOfflineFallback } from "@/data/pwa/offline-catalog";
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

describe("online lists keep offline creates visible before sync, exactly once after", () => {
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


  it("before sync: visible once, counts right; after sync: still once (no dup after remap), counts = server", async () => {
    await freshDexie();
    applySession();
    offline = false;
    const base = { p: (await listCachedProducts()).length, c: (await listCachedCustomers()).length, s: (await listCachedSuppliers()).length };
    offline = true;
    const p = await createProductWithOfflineFallback({ name: "Prod offline L", price: 1000, stock: 0, avgCost: 0 }, newEntityId());
    const c = await createCustomerWithOfflineFallback({ name: "Cliente offline L" }, newEntityId());
    const s = await createSupplierWithOfflineFallback({ name: "Proveedor offline L" }, newEntityId());
    expect([p.mode, c.mode, s.mode]).toEqual(["offline", "offline", "offline"]);

    // Online, sync blocked (not run yet).
    offline = false;
    const count = (rows: Array<{ name: string }>, name: string) => rows.filter((r) => r.name === name).length;
    const pl = await listCachedProducts();
    const cl = await listCachedCustomers();
    const sl = await listCachedSuppliers();
    expect([count(pl, "Prod offline L"), count(cl, "Cliente offline L"), count(sl, "Proveedor offline L")]).toEqual([1, 1, 1]);
    expect([pl.length, cl.length, sl.length]).toEqual([base.p + 1, base.c + 1, base.s + 1]);

    // Sync finishes: remapped to server ids, still exactly once.
    await syncAllPending(biz);
    const pl2 = await listCachedProducts();
    const cl2 = await listCachedCustomers();
    const sl2 = await listCachedSuppliers();
    expect([count(pl2, "Prod offline L"), count(cl2, "Cliente offline L"), count(sl2, "Proveedor offline L")]).toEqual([1, 1, 1]);
    expect([pl2.length, cl2.length, sl2.length]).toEqual([base.p + 1, base.c + 1, base.s + 1]);
    const db = prisma as unknown as { product: { count(a: unknown): Promise<number> }; customer: { count(a: unknown): Promise<number> }; supplier: { count(a: unknown): Promise<number> } };
    expect(pl2.length).toBe(await db.product.count({ where: { businessId: biz, archivedAt: null } }));
    expect(cl2.length).toBe(await db.customer.count({ where: { businessId: biz, archivedAt: null } }));
    expect(sl2.length).toBe(await db.supplier.count({ where: { businessId: biz } }));
  });
});
