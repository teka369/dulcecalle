import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("R2-B M3: Gestionar cajas error state has Reintentar, does not swallow unassigned-moves errors, and detail close/carry reuse requestId", () => {
  it("GestionarCajasPage includes api.cash.unassigned() in Promise.all and renders a Reintentar button on error", () => {
    const page = readFileSync("src/app/mas/caja/gestionar/page.tsx", "utf8");
    expect(page).not.toContain(".catch(() => setOrphans([]))");
    expect(page).toContain("api.cash.unassigned()");
    const errBlock = page.slice(page.indexOf('title="No se pudieron cargar las cajas."'));
    expect(errBlock).toContain("Reintentar");
  });

  it("GestionarCajaDetailPage reuses a stable requestId ref across retries of closeCounted and carry", () => {
    const detail = readFileSync("src/app/mas/caja/gestionar/[id]/page.tsx", "utf8");
    expect(detail).toContain("closeRequestIdRef");
    expect(detail).toContain("carryRequestIdRef");
    expect(detail).toContain("cash.close(params.id, Number(counted), closeRequestIdRef.current)");
  });
});
