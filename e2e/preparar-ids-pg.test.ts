/**
 * loop/v1 Tester: «product.id must be a UUID string» in Preparar. Real ids
 * against the REAL Nest backend + embedded PostgreSQL: a product created
 * offline (client UUID), read for Preparar offline, online before its create
 * synced, after the sync (server UUID) and through the stale local id.
 * Same harness as offline-prep-sell-pg.
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
import { getCachedProduct, listCachedCustomers, listCachedProducts } from "@/data/pwa/catalog";
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

describe("Preparar source read with offline / pending / remapped product ids", () => {
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


  it("never sends a non-UUID id, never surfaces a technical message, and resolves the id at every stage", async () => {
    await freshDexie();
    applySession();
    offline = false;
    await listCachedProducts();
    offline = true;
    const created = await createProductWithOfflineFallback(
      { name: "Insumo offline", price: 0, stock: 4, avgCost: 500, sellable: false },
      newEntityId(),
    );
    if (created.mode !== "offline") throw new Error("expected offline create");
    const localId = created.productId;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(localId).toMatch(UUID);

    // 1) Offline: Preparar reads the local row.
    expect((await getCachedProduct(localId)).name).toBe("Insumo offline");

    // 2) Online, create not synced yet (e.g. sync still running / failed): must still resolve locally.
    offline = false;
    const before = await getCachedProduct(localId).then((p) => p.name, (e: unknown) => `ERR ${String(e)}`);
    expect(before).toBe("Insumo offline");

    // 3) After sync: server UUID resolves; the stale local id resolves to the same product.
    await syncAllPending(biz);
    const server = await prisma.product.findFirst({ where: { businessId: biz, name: "Insumo offline" } });
    expect(server?.id).toMatch(UUID);
    expect((await getCachedProduct(server!.id)).id).toBe(server!.id);
    const stale = await getCachedProduct(localId).then((p) => p.id, (e: unknown) => `ERR ${String(e)}`);
    expect(stale).toBe(server!.id);

    const sentIds = attempts
      .filter((a) => !a.blocked)
      .map((a) => new URL(a.url).pathname.match(/\/products\/([^/]+)/)?.[1])
      .filter((x): x is string => Boolean(x));
    expect(sentIds.every((x) => UUID.test(x)), sentIds.join(",")).toBe(true);
  });
});
