import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CASH_OFFLINE_NOCACHE } from "./cash";

/** loop/v1 pass2 D9: Caja offline says «Sin conexión» once (global pill) and hides Reintentar while offline. */
describe("Caja offline copy (D9)", () => {
  it("title and band do not repeat «Sin conexión»", () => {
    expect(CASH_OFFLINE_NOCACHE.title).not.toMatch(/Sin conexión/);
    const page = readFileSync("src/app/mas/caja/page.tsx", "utf8");
    expect(page).not.toMatch(/"Sin conexión/);
    expect(page).not.toContain("capturedAt: lastReadyAt");
  });
  it("not-yet-saved state uses the agreed copy and «Volver a Inicio», no Reintentar", () => {
    expect(CASH_OFFLINE_NOCACHE).toEqual({
      title: "Caja todavía se está guardando",
      body: "Estará lista para usar sin internet cuando vuelva la conexión.",
      action: "Volver a Inicio",
    });
    const page = readFileSync("src/app/mas/caja/page.tsx", "utf8");
    const gate = page.slice(page.indexOf('gate === "offline"'), page.indexOf('kind="error"'));
    expect(gate).toContain('href="/"');
    expect(gate).not.toContain("retryButton");
  });
  it("Reintentar only when online", () => {
    const page = readFileSync("src/app/mas/caja/page.tsx", "utf8");
    expect(page).toContain("const retryButton = !online ? undefined :");
  });
});
