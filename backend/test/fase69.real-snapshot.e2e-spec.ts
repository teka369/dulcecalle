import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { checksumCanonical } from "../../src/storage/canonical";
import { importDexieDump, reconcileImport } from "../migration";
import type { DexieDump } from "../migration/types";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

const SNAPSHOT_PATH = path.join(
  __dirname,
  "../../attachments/dulcecalle-snapshot-544b330b-e499-40b4-8909-cdcf6745fc64.json",
);

const HAS_PRIVATE_SNAPSHOT = fs.existsSync(SNAPSHOT_PATH);

const DECLARED = {
  snapshotId: "544b330b-e499-40b4-8909-cdcf6745fc64",
  schemaVersion: 8,
  dbName: "dulcecalle",
  checksum: "1f1e1c2f7a04d5132f8e76ab62fcd1ca4930e4290723891245ce406623828126",
};

describe("Fase 6.9 real DEVICE_COPY snapshot → Postgres TEST", () => {
  if (!HAS_PRIVATE_SNAPSHOT) {
    it.skip("private DEVICE_COPY snapshot is not available (gitignored attachments/)", () => undefined);
    return;
  }

  let pg: PgHandle | null = null;
  let prisma: PrismaClient;
  let businessId: string;
  let dump: DexieDump;
  let raw: {
    snapshotId: string;
    source: string;
    claim: string;
    schemaVersion: number;
    dbName: string;
    checksum: string;
    recordCounts: Record<string, number>;
    tables: DexieDump["tables"];
  };

  beforeAll(async () => {
    const text = fs.readFileSync(SNAPSHOT_PATH, "utf8");
    raw = JSON.parse(text);
    dump = {
      source: "DEXIE",
      claim: "DEVICE_COPY",
      tables: raw.tables,
    };

    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.MIGRATION_ENV = "TEST";
    execSync("npx prisma migrate deploy", {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });
    prisma = new PrismaClient({ datasources: { db: { url: pg.url } } });
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: "fase69-real@test.co",
        passwordHash: "unused",
      },
    });
    const biz = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: "DulceCalle REAL-TEST",
        timezone: "America/Bogota",
      },
    });
    await prisma.businessMembership.create({
      data: {
        id: randomUUID(),
        businessId: biz.id,
        userId: user.id,
        role: "owner",
      },
    });
    businessId = biz.id;
  }, 180000);

  afterAll(async () => {
    await prisma?.$disconnect();
    pg?.stop();
  });

  it("snapshot metadata matches the owner file; checksum round-trips", async () => {
    expect(raw.snapshotId).toBe(DECLARED.snapshotId);
    expect(raw.source).toBe("DEXIE");
    expect(raw.claim).toBe("DEVICE_COPY");
    expect(raw.schemaVersion).toBe(DECLARED.schemaVersion);
    expect(raw.dbName).toBe(DECLARED.dbName);
    expect(raw.checksum).toBe(DECLARED.checksum);
    for (const [table, n] of Object.entries(raw.recordCounts)) {
      expect(raw.tables[table as keyof typeof raw.tables].length).toBe(n);
    }
    const debt = raw.tables.customers.reduce((s, c) => s + c.debt, 0);
    const stock = raw.tables.products.reduce((s, p) => s + p.stock, 0);
    expect(debt).toBe(45_200);
    expect(stock).toBe(74);
    const first = await checksumCanonical(raw.tables);
    const again = await checksumCanonical(
      JSON.parse(JSON.stringify(raw.tables)) as unknown,
    );
    expect(first).toBe(again);
    expect(pg?.url).toMatch(/127\.0\.0\.1|localhost/);
    expect(process.env.MIGRATION_ENV).toBe("TEST");
  });

  it("refuses this dump if it is not DEVICE_COPY", async () => {
    await expect(
      importDexieDump(
        prisma,
        { source: "DEXIE", tables: dump.tables } as DexieDump,
        { businessId },
      ),
    ).rejects.toThrow(/DEVICE_COPY|TEST_FIXTURE/);
  });

  it("imports the real snapshot into local TEST Postgres", async () => {
    const result = await importDexieDump(prisma, dump, { businessId });
    expect(result.warnings.some((w) => w.code === "DEMO_SIGNALS")).toBe(false);

    expect(await prisma.product.count({ where: { businessId } })).toBe(7);
    expect(await prisma.customer.count({ where: { businessId } })).toBe(14);
    expect(await prisma.supplier.count({ where: { businessId } })).toBe(1);
    expect(await prisma.stockMove.count({ where: { businessId } })).toBe(7);
    expect(await prisma.initialDebt.count({ where: { businessId } })).toBe(14);
    expect(await prisma.sale.count({ where: { businessId } })).toBe(0);
    expect(await prisma.saleLine.count({ where: { businessId } })).toBe(0);
    expect(await prisma.saleReturn.count({ where: { businessId } })).toBe(0);
    expect(await prisma.saleReturnLine.count({ where: { businessId } })).toBe(0);
    expect(await prisma.cashSession.count({ where: { businessId } })).toBe(0);
    expect(await prisma.cashMove.count({ where: { businessId } })).toBe(0);
    expect(await prisma.customerPayment.count({ where: { businessId } })).toBe(0);
    expect(await prisma.expense.count({ where: { businessId } })).toBe(0);

    const products = await prisma.product.findMany({ where: { businessId } });
    const stockTotal = products.reduce((s, p) => s + p.stock, 0);
    expect(stockTotal).toBe(74);
    expect(products.every((p) => p.avgCost === 0n)).toBe(true);
    expect(products.every((p) => p.legacyDexieId != null)).toBe(true);

    const moves = await prisma.stockMove.findMany({ where: { businessId } });
    expect(moves.every((m) => m.unitCost === 0n)).toBe(true);
    expect(moves.every((m) => m.reason === "inicial")).toBe(true);
    for (const m of moves) {
      expect(products.some((p) => p.id === m.productId)).toBe(true);
    }

    const customers = await prisma.customer.findMany({ where: { businessId } });
    const initials = await prisma.initialDebt.findMany({ where: { businessId } });
    const initialSum = initials.reduce((s, d) => s + Number(d.amount), 0);
    const debtSum = customers.reduce((s, c) => s + Number(c.debt), 0);
    expect(initialSum).toBe(45_200);
    expect(debtSum).toBe(45_200);
    for (const d of initials) {
      expect(customers.some((c) => c.id === d.customerId)).toBe(true);
    }

    const report = await reconcileImport(prisma, dump, businessId, result.warnings);
    expect(report.orphans).toBe(0);
    expect(report.balances.debtOk).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.amounts.initialDebtTotal).toBe(45_200);
  });

  it("second import is idempotent", async () => {
    const before = {
      products: await prisma.product.count({ where: { businessId } }),
      customers: await prisma.customer.count({ where: { businessId } }),
      debts: await prisma.initialDebt.count({ where: { businessId } }),
      moves: await prisma.stockMove.count({ where: { businessId } }),
      map: await prisma.importIdMap.count({ where: { businessId } }),
    };
    const again = await importDexieDump(prisma, dump, { businessId });
    expect(again.mapSize).toBe(before.map);
    expect(await prisma.product.count({ where: { businessId } })).toBe(before.products);
    expect(await prisma.customer.count({ where: { businessId } })).toBe(
      before.customers,
    );
    expect(await prisma.initialDebt.count({ where: { businessId } })).toBe(
      before.debts,
    );
    expect(await prisma.stockMove.count({ where: { businessId } })).toBe(before.moves);
    const debt = await prisma.customer.aggregate({
      where: { businessId },
      _sum: { debt: true },
    });
    expect(Number(debt._sum.debt)).toBe(45_200);
  });
});
