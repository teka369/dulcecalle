import { describe, expect, it } from "vitest";
import type { CustomerLedger } from "@/data/http/customer-api";
import { customerPortalTotals } from "@/data/pwa/customer-portal";
import { activePortalTab, debtHero, newestFirst, ownLedger, purchaseLabel, statementSign } from "./portal";

function ledger(over: Partial<CustomerLedger["customer"]> = {}): CustomerLedger {
  return {
    customer: { id: "c1", code: "C-1", name: "Ana", debt: 30_000, ...over },
    sales: [
      { id: "s1", saleTotal: 50_000, amountReceived: 20_000, credit: 30_000, paymentKind: "credit", createdAt: "2026-10-01T10:00:00Z" },
    ],
    payments: [{ id: "p1", amount: 10_000, method: "Nequi", createdAt: "2026-10-02T10:00:00Z" }],
    initials: [],
  } as unknown as CustomerLedger;
}

describe("portal balance", () => {
  it("hero shows the server debt, not received or abonado totals", () => {
    const l = ledger();
    const hero = debtHero(l);
    const totals = customerPortalTotals(l);
    expect(hero.value).toBe(30_000);
    expect(hero.value).not.toBe(l.sales[0].amountReceived);
    expect(hero.value).not.toBe(totals.totalAbonado);
  });
  it("zero debt reads Al día", () => {
    expect(debtHero(ledger({ debt: 0 }))).toMatchObject({ owes: false, label: "Al día" });
  });
  it("statement signs: pago/devolución lower debt, venta raises it", () => {
    expect(statementSign({ kind: "pago" }).sign).toBe("−");
    expect(statementSign({ kind: "devolucion" }).word).toBe("Baja tu deuda");
    expect(statementSign({ kind: "venta" } as never).sign).toBe("+");
  });
  it("labels purchases", () => {
    expect(purchaseLabel(0, "cash")).toBe("Compra");
    expect(purchaseLabel(10, "partial")).toBe("Venta parcial");
    expect(purchaseLabel(10, "credit")).toBe("A crédito");
  });
});

describe("portal isolation", () => {
  it("never renders another customer's / business's ledger", () => {
    expect(ownLedger(ledger(), "c1")?.customer.id).toBe("c1");
    expect(ownLedger(ledger({ id: "other-business-customer" }), "c1")).toBeNull();
    expect(ownLedger(ledger(), null)).toBeNull();
    expect(ownLedger(null, "c1")).toBeNull();
  });
});

describe("portal nav", () => {
  it("marks active tab including nested routes", () => {
    expect(activePortalTab("/cliente")).toBe("/cliente");
    expect(activePortalTab("/cliente/compras/abc")).toBe("/cliente/compras");
    expect(activePortalTab("/cliente/login")).toBeNull();
  });
  it("sorts newest first", () => {
    expect(newestFirst([{ createdAt: "2026-01-01" }, { createdAt: "2026-05-01" }])[0].createdAt).toBe("2026-05-01");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
describe("portal softs (P5 visual pass)", () => {
  it("active tab scrolls into view", () => {
    const s = readFileSync(join(__dirname, "CustomerChrome.tsx"), "utf8");
    expect(s).toContain('scrollIntoView?.({ inline: "nearest"');
  });
  it("no raw ISO dates in portal pages", () => {
    for (const p of ["cuenta/page.tsx", "pagos/page.tsx", "compras/page.tsx", "compras/[id]/page.tsx"]) {
      const s = readFileSync(join(__dirname, "../../app/cliente", p), "utf8");
      expect(s, p).not.toMatch(/=\{(row|p|s|sale|r)\.occurredOn\}/);
    }
  });
});

import { ApiError, NetworkError } from "@/data/errors";
import { PORTAL_LOAD_FAILED_MESSAGE, PORTAL_OFFLINE_MESSAGE, portalErrorMessage } from "./portal";

describe("portal error copy", () => {
  it("online: a failing API reads 'No se pudo cargar', never 'Sin conexión'", () => {
    expect(portalErrorMessage(new NetworkError("Sin conexión."), true)).toBe(PORTAL_LOAD_FAILED_MESSAGE);
    expect(portalErrorMessage(new ApiError("X", "boom", 503), true)).toBe(PORTAL_LOAD_FAILED_MESSAGE);
    expect(portalErrorMessage(new Error("Sin conexión."), true)).toBe(PORTAL_LOAD_FAILED_MESSAGE);
    expect(portalErrorMessage(new ApiError("AUTH", "Inicia sesión.", 401), true)).toBe("Inicia sesión.");
  });
  it("offline: 'Sin conexión.'", () => {
    expect(portalErrorMessage(new NetworkError(), false)).toBe(PORTAL_OFFLINE_MESSAGE);
  });
});
