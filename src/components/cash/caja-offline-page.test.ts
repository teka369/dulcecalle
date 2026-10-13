import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const read = (p: string) => readFileSync(join(__dirname, "../../app", p), "utf8");

describe("S5 offline without cache", () => {
  it("Caja shows offline/error before any Abrir caja branch", () => {
    const s = read("mas/caja/page.tsx");
    const guard = s.indexOf('offlineView === "offline-nocache"');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(s.indexOf("CASH_COPY.abrirCaja"));
    expect(s).toContain("CASH_OFFLINE_NOCACHE");
  });
  it("Gastos shows offline/error before «Aún no hay gastos»", () => {
    const s = read("mas/gastos/page.tsx");
    expect(s.indexOf('offlineView === "offline-nocache"')).toBeLessThan(s.indexOf("Aún no hay gastos."));
    expect(s).toContain("GASTOS_OFFLINE_NOCACHE");
  });
  it("Cerrar contando is disabled when it cannot be used (S3)", () => {
    expect(read("mas/caja/gestionar/[id]/page.tsx")).toContain('disabled: !detail.canCountClose');
  });
});
