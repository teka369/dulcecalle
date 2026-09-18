import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import {
  IMPORT_ORDER,
  importDexieDump,
  occurredOnFromEpoch,
  reconcileImport,
  testDexieDump,
  TS_SEP17_2330,
  TS_SEP18_0000,
} from "../migration";
import { dateKeyUtc } from "../migration/dates";
import { mapRequestId } from "../migration/request-id";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

describe("Fase 6.8 Dexie → Postgres TEST dry-run", () => {
  let pg: PgHandle | null = null;
  let prisma: PrismaClient;
  let businessId: string;
  const dump = testDexieDump();

  beforeAll(async () => {
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
        email: "import-dry-run@test.co",
        passwordHash: "unused",
      },
    });
    const biz = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: "DulceCalle TEST",
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

  it("refuses import unless MIGRATION_ENV=TEST on local Postgres", async () => {
    process.env.MIGRATION_ENV = "PROD";
    await expect(
      importDexieDump(prisma, dump, { businessId }),
    ).rejects.toThrow(/MIGRATION_ENV must be TEST/);
    process.env.MIGRATION_ENV = "TEST";
  });

  it("timezone: 04:30Z is 17 Sep Bogotá, 05:00Z is 18 Sep", () => {
    expect(dateKeyUtc(occurredOnFromEpoch(TS_SEP17_2330))).toBe("2026-09-17");
    expect(dateKeyUtc(occurredOnFromEpoch(TS_SEP18_0000))).toBe("2026-09-18");
  });

  it("imports the TEST fixture with identity, FKs, snapshots, cash, $45.000", async () => {
    const result = await importDexieDump(prisma, dump, { businessId });
    expect(result.mapSize).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.code === "DEMO_SIGNALS")).toBe(true);
    const report = await reconcileImport(prisma, dump, businessId, result.warnings);
    expect(report.ok).toBe(true);
    expect(report.orphans).toBe(0);
    expect(report.warnings.some((w) => w.code === "LEGACY_STOCK_NO_INICIAL")).toBe(
      true,
    );
    expect(report.counts.products.ok).toBe(true);
    expect(report.counts.sales.ok).toBe(true);
    expect(report.counts.initialDebts.pg).toBe(1);
    expect(report.amounts.initialDebtTotal).toBe(45_000);
    expect(report.amounts.salesTotal).toBe(4600);
    expect(report.amounts.creditSales).toBe(1600);
    expect(report.amounts.paymentsTotal).toBe(500);
    expect(report.amounts.expensesTotal).toBe(200);
    expect(report.balances.debtOk).toBe(true);
    expect(report.balances.customerDebt).toBe(45_300);
    expect(report.balances.cashExpectedEfectivo).toBe(7800);
    expect(report.balances.nequiExpected).toBe(500);

    const galleta = await prisma.product.findFirstOrThrow({
      where: { businessId, name: "Galleta de chocolate italiano" },
    });
    expect(galleta.id).not.toBe("1");
    expect(galleta.legacyDexieId).toBe(1);
    expect(galleta).not.toHaveProperty("gifted");

    const mapped = await prisma.importIdMap.findUniqueOrThrow({
      where: {
        businessId_tableName_dexieId: {
          businessId,
          tableName: "products",
          dexieId: 1,
        },
      },
    });
    expect(mapped.pgId).toBe(galleta.id);

    const caramelo = await prisma.product.findFirstOrThrow({
      where: { businessId, name: "Caramelo histórico" },
    });
    expect(Number(caramelo.price)).toBe(1000);
    expect(Number(caramelo.avgCost)).toBe(500);
    const line = await prisma.saleLine.findFirstOrThrow({
      where: { businessId, productId: caramelo.id },
    });
    expect(Number(line.unitPrice)).toBe(800);
    expect(Number(line.unitCost)).toBe(300);
    expect(line.saleId).not.toBe("2");
    expect(line.productId).toBe(caramelo.id);

    const paid = await prisma.sale.findFirstOrThrow({
      where: { businessId, paymentKind: "paid" },
    });
    expect(paid.method).toBe("Efectivo");
    expect(dateKeyUtc(paid.occurredOn)).toBe("2026-09-17");
    expect(paid.customerId).toBeNull();

    const credit = await prisma.sale.findFirstOrThrow({
      where: { businessId, paymentKind: "credit" },
    });
    expect(credit.method).toBeNull();
    const juan = await prisma.customer.findFirstOrThrow({
      where: { businessId, name: "Fiado Juan" },
    });
    expect(credit.customerId).toBe(juan.id);

    const vecina = await prisma.customer.findFirstOrThrow({
      where: { businessId, name: "Vecina María" },
    });
    expect(Number(vecina.debt)).toBe(45_000);
    const initial = await prisma.initialDebt.findFirstOrThrow({
      where: { businessId, customerId: vecina.id },
    });
    expect(Number(initial.amount)).toBe(45_000);
    expect(initial.requestId).toBe(mapRequestId("inicial-vecina-1").requestId);
    const vecinaSales = await prisma.sale.count({
      where: { businessId, customerId: vecina.id },
    });
    expect(vecinaSales).toBe(0);
    const vecinaCash = await prisma.cashMove.count({
      where: { businessId, refId: initial.id },
    });
    expect(vecinaCash).toBe(0);

    const session = await prisma.cashSession.findFirstOrThrow({
      where: { businessId },
    });
    expect(Number(session.openingFloat)).toBe(5000);
    const openingAsMove = await prisma.cashMove.count({
      where: { businessId, kind: "sale", amount: 5000n },
    });
    expect(openingAsMove).toBe(0);

    expect(IMPORT_ORDER[0]).toBe("settings");
    expect(IMPORT_ORDER.indexOf("sales")).toBeLessThan(
      IMPORT_ORDER.indexOf("sale_lines"),
    );
    expect(IMPORT_ORDER.indexOf("expenses")).toBeLessThan(
      IMPORT_ORDER.indexOf("cash_moves"),
    );
  });

  it("second import does not duplicate rows or change balances", async () => {
    const before = await prisma.sale.count({ where: { businessId } });
    const beforeMap = await prisma.importIdMap.count({ where: { businessId } });
    const again = await importDexieDump(prisma, dump, { businessId });
    expect(again.mapSize).toBe(beforeMap);
    expect(await prisma.sale.count({ where: { businessId } })).toBe(before);
    expect(await prisma.product.count({ where: { businessId } })).toBe(3);
    expect(await prisma.initialDebt.count({ where: { businessId } })).toBe(1);
    const report = await reconcileImport(prisma, dump, businessId);
    expect(report.ok).toBe(true);
    expect(report.amounts.initialDebtTotal).toBe(45_000);
  });

  it("rollback leaves no partial financial state", async () => {
    const other = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: "Rollback probe",
        timezone: "America/Bogota",
      },
    });
    await expect(
      importDexieDump(prisma, dump, {
        businessId: other.id,
        failAfter: "products",
      }),
    ).rejects.toThrow(/rollback probe/);
    expect(await prisma.product.count({ where: { businessId: other.id } })).toBe(0);
    expect(await prisma.sale.count({ where: { businessId: other.id } })).toBe(0);
    expect(await prisma.customer.count({ where: { businessId: other.id } })).toBe(0);
    expect(await prisma.importIdMap.count({ where: { businessId: other.id } })).toBe(
      0,
    );
    expect(randomUUID()).toBeTruthy();
  });
});
