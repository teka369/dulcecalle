/**
 * C04 — imputación de abonos, client data layer → real HTTP → PostgreSQL.
 * Same harness as offline-client-pg.test.ts (fake-indexeddb, embedded PG,
 * fictitious data). T20 projection replaced on sync, T21 offline overpay,
 * T22 portal «Saldada» / «Pendiente $X», T23 isolation of a target sale.
 */
import "fake-indexeddb/auto";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPwaApi, resetPwaApi } from "@/data/pwa/api";
import { listCachedCustomers, listCachedProducts } from "@/data/pwa/catalog";
import { createCustomerWithOfflineFallback, createProductWithOfflineFallback } from "@/data/pwa/offline-catalog";
import { createPaymentWithOfflineFallback } from "@/data/pwa/offline-payments";
import { createSaleWithOfflineFallback } from "@/data/pwa/offline-sales";
import { loadCustomerMoneyState } from "@/data/pwa/customer-allocations";
import { syncAllPending } from "@/data/pwa/sync-coordinator";
import { getPwaAuthSession, resetPwaAuthSessionForTests } from "@/data/http/session";
import { CustomerApi } from "@/data/http/customer-api";
import { CustomerSession } from "@/data/http/customer-session";
import { purchaseLabel } from "@/components/customer/portal";
import { ApiError } from "@/data/errors";
import { __reopenLocalDbForTests, __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";

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
type PrismaLike = {
  $disconnect(): Promise<void>;
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
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

describe("C04 client data layer to PostgreSQL", () => {
  beforeAll(async () => {
    const readyFile = path.join("/tmp", `dc-c04-pg-${process.pid}.json`);
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


  async function setup(name: string, sales: number[]) {
    await freshDexie();
    applySession();
    offline = false;
    const created = await createCustomerWithOfflineFallback({ name }, newEntityId());
    if (created.mode !== "online") throw new Error("customer should be online");
    const product = await createProductWithOfflineFallback(
      { name: `Gomitas ${name}`, price: 1_000, stock: 100, avgCost: 400 },
      newEntityId(),
    );
    if (product.mode !== "online") throw new Error("product should be online");
    await listCachedCustomers();
    await listCachedProducts();
    const customerId = created.customer.id;
    const saleIds: string[] = [];
    for (const units of sales) {
      const sale = await createSaleWithOfflineFallback(
        { lines: [{ productId: product.product.id, qty: units }], paymentKind: "credit", customerId, amountReceived: 0 },
        newEntityId(),
      );
      if (sale.mode !== "online") throw new Error("sale should be online");
      saleIds.push(sale.sale.id);
    }
    await listCachedCustomers();
    return { customerId, saleIds, productId: product.product.id };
  }

  async function invariantA3(customerId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ debt: bigint; open: bigint | null }>>(
      `SELECT c.debt,
              (SELECT COALESCE(SUM(s.credit),0) FROM sales s WHERE s.customer_id = c.id AND s.business_id = c.business_id)
            + (SELECT COALESCE(SUM(d.amount),0) FROM initial_debts d WHERE d.customer_id = c.id AND d.business_id = c.business_id)
            - (SELECT COALESCE(SUM(a.amount),0) FROM debt_allocations a WHERE a.customer_id = c.id AND a.business_id = c.business_id AND a.target_type <> 'credit') AS open
         FROM customers c WHERE c.id = $1::uuid`,
      customerId,
    );
    expect(Number(rows[0].open)).toBe(Number(rows[0].debt));
  }

  it("T20: offline abono is an estimate; after sync the server allocations replace it (no double subtract)", async () => {
    const { customerId, saleIds } = await setup("Ana T20", [1, 2]);
    offline = true;
    const pay = await createPaymentWithOfflineFallback({ customerId, amount: 1_500, method: "Efectivo" }, newEntityId());
    expect(pay.mode).toBe("offline");
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(1_500);
    const est = await loadCustomerMoneyState(customerId);
    expect(est.source).toBe("estimate");

    reopen();
    offline = false;
    const synced = await syncAllPending(biz);
    expect(synced.payments).toMatchObject({ synced: 1, failed: 0 });
    await listCachedCustomers();
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(1_500);
    const live = await loadCustomerMoneyState(customerId);
    expect(live.source).toBe("server");
    expect(live.debt).toBe(1_500);
    expect(live.obligations.map((o) => [o.id, o.open])).toEqual([
      [saleIds[0], 0],
      [saleIds[1], 1_500],
    ]);
    await invariantA3(customerId);
  });

  it("T21: offline overpay is allowed and becomes saldo a favor on sync", async () => {
    const { customerId } = await setup("Beto T21", [1]);
    offline = true;
    const pay = await createPaymentWithOfflineFallback({ customerId, amount: 3_000, method: "Nequi" }, newEntityId());
    expect(pay.mode).toBe("offline");
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(0);
    const op = await getLocalDb().outbox.get((pay as { paymentId: string }).paymentId);
    expect(op?.payload).toMatchObject({ projectedToDebt: 1_000, projectedToCredit: 2_000 });

    offline = false;
    const synced = await syncAllPending(biz);
    expect(synced.payments).toMatchObject({ synced: 1, failed: 0 });
    const row = await prisma.$queryRawUnsafe<Array<{ debt: bigint; credit_balance: bigint }>>(
      `SELECT debt, credit_balance FROM customers WHERE id = $1::uuid`,
      customerId,
    );
    expect(Number(row[0].debt)).toBe(0);
    expect(Number(row[0].credit_balance)).toBe(2_000);
    await listCachedCustomers();
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(0);
    expect((await loadCustomerMoneyState(customerId)).creditBalance).toBe(2_000);
    await invariantA3(customerId);
  });

  it("T22: portal shows A «Saldada» and B «Pendiente $ 1.000» after a FIFO abono", async () => {
    const { customerId, saleIds } = await setup("Carla T22", [1, 2]);
    await getPwaApi().customers.pay(customerId, { amount: 2_000, method: "Efectivo" }, newEntityId());
    await getPwaApi().customers.setPin(customerId, "482913");
    const code = (await getPwaApi().customers.get(customerId)).code;
    const portal = new CustomerApi(ready.baseUrl, new CustomerSession(null));
    await portal.login(code, "482913", biz);
    const ledger = await portal.ledger();
    const a = ledger.sales.find((s) => s.id === saleIds[0])!;
    const b = ledger.sales.find((s) => s.id === saleIds[1])!;
    expect(purchaseLabel(a.credit, a.paymentKind, a.openBalance)).toBe("Saldada");
    expect(purchaseLabel(b.credit, b.paymentKind, b.openBalance)).toMatch(/^Pendiente \$\s?1\.000$/);
    expect(JSON.stringify(ledger)).not.toContain("createdBy");
  });

  it("T23: an abono targeting another customer's sale is 422 and writes nothing", async () => {
    const one = await setup("Dora T23", [1]);
    const other = await setup("Eva T23", [1]);
    const before = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM debt_allocations WHERE business_id = $1::uuid`,
      biz,
    );
    await expect(
      getPwaApi().customers.pay(
        one.customerId,
        { amount: 500, method: "Efectivo", target: { mode: "sale", saleId: other.saleIds[0] } },
        newEntityId(),
      ),
    ).rejects.toMatchObject({ code: "ALLOCATION_INVALID", status: 422 });
    const after = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM debt_allocations WHERE business_id = $1::uuid`,
      biz,
    );
    expect(Number(after[0].n)).toBe(Number(before[0].n));
    const pays = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM customer_payments WHERE customer_id = $1::uuid`,
      one.customerId,
    );
    expect(Number(pays[0].n)).toBe(0);
    expect(ApiError).toBeDefined();
  });
});
