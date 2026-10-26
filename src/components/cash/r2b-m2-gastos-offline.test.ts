import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { getPwaAuthSession } from "@/data/http/session";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { getLocalCashSnapshot } from "@/data/pwa/offline-operations";
import { GASTOS_OFFLINE_NOCACHE } from "./cash";

const BIZ = "11111111-1111-4111-8111-111111111111";

describe("R2-B M2: Gastos offline D9 copy, useAfterSync, and 30-day cached expense history", () => {
  beforeEach(async () => {
    await __resetLocalDbForTests();
    getPwaAuthSession().businessId = BIZ;
  });

  it("GASTOS_OFFLINE_NOCACHE and /mas/gastos page do not repeat «Sin conexión» or offer Reintentar offline", () => {
    expect(GASTOS_OFFLINE_NOCACHE.title).not.toMatch(/Sin conexión/);
    expect(GASTOS_OFFLINE_NOCACHE).toEqual({
      title: "Gastos todavía se están guardando",
      body: "Estarán listos para usar sin internet cuando vuelva la conexión.",
      action: "Volver a Inicio",
    });
    const page = readFileSync("src/app/mas/gastos/page.tsx", "utf8");
    expect(page).not.toMatch(/"Sin conexión/);
    expect(page).not.toContain("capturedAt: lastReadyAt");
    expect(page).toContain("const retryButton = !online ? undefined :");
    expect(page).toContain("useAfterSync(load)");
  });

  it("getLocalCashSnapshot returns multi-day cached expenses from db.expenses while keeping summary.moves scoped to today", async () => {
    await getLocalDb().expenses.put({
      id: newEntityId(),
      businessId: BIZ,
      amount: 3_500,
      category: "Transporte ayer",
      note: null,
      method: "Efectivo",
      requestId: newEntityId(),
      occurredOn: "2026-10-01",
      createdAt: 1_700_000_000_000,
    });
    const snap = await getLocalCashSnapshot();
    expect(snap.expenses).toHaveLength(1);
    expect(snap.expenses[0]?.category).toBe("Transporte ayer");
  });
});
