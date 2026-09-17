import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "@/storage/db";
import {
  demoInicioSnapshot,
  loadDemoData,
  startOfLocalDay,
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
});
