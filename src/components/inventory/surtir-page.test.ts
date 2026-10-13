import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(__dirname, "../../app/inventario/[id]/surtir/page.tsx"), "utf8");

describe("surtir page (offline inline supplier uses the outbox queue)", () => {
  it("has no offline guard blocking a new inline supplier", () => {
    expect(page).not.toContain("OFFLINE_NEW_SUPPLIER");
    expect(page).not.toContain("navigator.onLine");
    expect(page).not.toContain("PENDING_SUPPLIER_MESSAGE");
  });
  it("passes the typed supplier and a stable requestId to the store", () => {
    expect(page).toContain("supplierNameCreate: supplierCreate");
    expect(page).toContain("requestId: requestIdRef.current");
  });
  it("keeps errors at the top of the sheet", () => {
    const sheet = page.indexOf("<Sheet");
    const err = page.indexOf('<StateBlock kind="error" title={error} />', sheet);
    expect(err).toBeGreaterThan(sheet);
    expect(page.indexOf("<AmountField", sheet) === -1 || err < page.indexOf("<AmountField", sheet)).toBe(true);
  });
});
