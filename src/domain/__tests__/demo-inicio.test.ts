import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "@/storage/db";
import {
  demoInicioSnapshot,
  isDbEmpty,
  loadDemoData,
  startOfLocalDay,
  wipeLocalData,
} from "@/storage/seed";
import { customerRepository, saleRepository } from "@/repositories";

describe("Cargar demo → Inicio metrics (today)", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("after loadDemoData: non-zero today metrics + debtor for abono", async () => {
    await loadDemoData();

    const snap = await demoInicioSnapshot();
    expect(snap.hoyVendido).toBeGreaterThan(0);
    expect(snap.porCobrar).toBeGreaterThan(0);
    expect(snap.stockBajo).toBeGreaterThan(0);
    expect(snap.customersWithDebt).toBeGreaterThanOrEqual(1);

    const withDebt = (await customerRepository.list()).filter((c) => c.debt > 0);
    expect(withDebt.length).toBeGreaterThanOrEqual(1);
    expect(withDebt[0]!.debt).toBeGreaterThan(0);

    const today = startOfLocalDay();
    const sales = await saleRepository.list();
    expect(sales.some((s) => s.createdAt >= today)).toBe(true);
    expect(sales.some((s) => s.paymentKind === "credit" && s.credit > 0)).toBe(
      true,
    );
  });

  it("loadDemoData is idempotent when catalog already present", async () => {
    await loadDemoData();
    const first = await demoInicioSnapshot();
    await loadDemoData();
    const second = await demoInicioSnapshot();
    expect(second).toEqual(first);
  });

  it("wipeLocalData clears everything so demo can load again", async () => {
    await loadDemoData();
    expect(await isDbEmpty()).toBe(false);
    await wipeLocalData();
    expect(await isDbEmpty()).toBe(true);
  });

  it("does not load demo on top of real customers or deudas", async () => {
    const customerId = await customerRepository.create({ name: "Pablo" });
    await customerRepository.recordInitialDebt({
      customerId,
      amount: 45_000,
      requestId: "real-deuda",
    });
    expect(await isDbEmpty()).toBe(false);
    await loadDemoData();
    const customers = await customerRepository.list();
    expect(customers).toHaveLength(1);
    expect(customers[0]?.name).toBe("Pablo");
    expect(customers[0]?.debt).toBe(45_000);
    expect(await saleRepository.list()).toHaveLength(0);
  });
});
