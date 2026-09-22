import "fake-indexeddb/auto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { __resetLocalDbForTests } from "@/data/local/db";
import { PALETTE_IDS } from "@/theme/palettes";
import { loadPalette, savePalette } from "@/theme/storage";
import {
  customerPortalTotals,
  customerPortalSummary,
} from "@/data/pwa/customer-portal";
import type { CustomerLedger } from "@/data/http/customer-api";
import { decideAuthGate } from "@/components/shell/auth-gate-decision";

const ROOT = join(__dirname, "..", "..", "..");

function src(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function ledger(): CustomerLedger {
  return {
    customer: { id: "c1", code: "DC-0001", name: "Juan", debt: 45200, createdAt: 1 },
    initials: [
      { id: "d1", amount: 20000, note: null, occurredOn: "2026-09-01", createdAt: 1 },
    ],
    sales: [
      {
        id: "s1", paymentKind: "credit", method: null, saleTotal: 30000,
        amountReceived: 0, credit: 30000, note: null, occurredOn: "2026-09-10",
        createdAt: 2, lines: [], returns: [],
      },
    ],
    payments: [
      {
        id: "p1", amount: 4800, method: "Efectivo", occurredOn: "2026-09-12",
        createdAt: 3,
      },
    ],
  };
}

describe("branding único Dulce Calle", () => {
  it("usa el logo oficial y ninguna marca alternativa en código", () => {
    expect(existsSync(join(ROOT, "public", "DulceCalle.png"))).toBe(true);
    const all = [
      src("src/app/layout.tsx"),
      src("src/app/login/page.tsx"),
      src("src/components/customer/CustomerChrome.tsx"),
    ].join("\n");
    expect(all).toContain("/DulceCalle.png");
    expect(all).not.toContain("next.svg");
    expect(all).not.toContain("vercel.svg");
    expect(all).not.toMatch(/emoji|🔥|🛒|store-icon|shop-logo/i);
  });

  it("metadata y manifest apuntan a iconos derivados del brand", () => {
    const layout = src("src/app/layout.tsx");
    expect(layout).toContain("/icons/icon-192.png");
    expect(layout).toContain("/icons/icon-512.png");
    const manifest = src("public/manifest.webmanifest");
    expect(manifest).toContain("/icons/icon-192.png");
    expect(manifest).toContain("/icons/icon-512.png");
    expect(existsSync(join(ROOT, "public", "icons", "icon-192.png"))).toBe(true);
    expect(existsSync(join(ROOT, "public", "icons", "icon-512.png"))).toBe(true);
    expect(existsSync(join(ROOT, "src", "app", "favicon.ico"))).toBe(true);
  });
});

describe("login con Cliente como prioridad", () => {
  it("muestra Cliente primero y conserva la tienda en ruta privada", () => {
    const page = src("src/app/login/page.tsx");
    expect(page).toContain("CustomerLoginForm");
    expect(page).toContain("/DulceCalle.png");
    expect(page).not.toContain("type=\"email\"");
    expect(page).not.toContain("Contraseña");
    expect(src("src/app/acceso-tienda/page.tsx")).toContain("StoreLoginForm");
    expect(src("src/components/auth/StoreLoginForm.tsx")).toContain("Correo");
  });
});

describe("tema del cliente reutiliza el sistema de la tienda", () => {
  it("expone las mismas 6 paletas en el portal", () => {
    expect(PALETTE_IDS).toHaveLength(6);
    const perfil = src("src/app/cliente/perfil/page.tsx");
    expect(perfil).toContain("ThemeSelector");
    const selector = src("src/components/theme/ThemeSelector.tsx");
    expect(selector).toContain("PALETTE_IDS");
    const apariencia = src("src/app/mas/apariencia/page.tsx");
    expect(apariencia).toContain("ThemeSelector");
  });

  it("persiste y sobrevive reload (Dexie + localStorage)", async () => {
    await __resetLocalDbForTests();
    await savePalette("ocean");
    expect(await loadPalette()).toBe("ocean");
    await savePalette("amber");
    expect(await loadPalette()).toBe("amber");
  });
});

describe("total abonado sin doble conteo", () => {
  function fullLedger(): CustomerLedger {
    return {
      customer: { id: "c1", code: "DC-0001", name: "Juan", debt: 15000, createdAt: 1 },
      initials: [
        { id: "d1", amount: 5000, note: null, occurredOn: "2026-09-01", createdAt: 1 },
      ],
      sales: [
        {
          id: "s-paid", paymentKind: "paid", method: "Efectivo", saleTotal: 10000,
          amountReceived: 10000, credit: 0, note: null, occurredOn: "2026-09-10",
          createdAt: 2, lines: [], returns: [],
        },
        {
          id: "s-partial", paymentKind: "partial", method: "Efectivo", saleTotal: 20000,
          amountReceived: 8000, credit: 12000, note: null, occurredOn: "2026-09-11",
          createdAt: 3, lines: [], returns: [
            {
              id: "r1", refundAmount: 0, debtReduced: 2000, method: null,
              note: null, occurredOn: "2026-09-12", createdAt: 4, lines: [],
            },
          ],
        },
      ],
      payments: [
        { id: "p1", amount: 3000, method: "Nequi", occurredOn: "2026-09-13", createdAt: 5 },
      ],
    };
  }

  it("suma pagos + abono parcial sin contar dos veces ni incluir contado", () => {
    const totals = customerPortalTotals(fullLedger());
    // Comprado: 10000 + 20000. Abonado: 3000 (pago) + 8000 (parcial).
    // El contado (10000) no es abono; la inicial y la devolución tampoco.
    expect(totals).toEqual({ totalComprado: 30000, totalAbonado: 11000, movimientos: 4 });
  });
});

describe("portal cliente comprensible", () => {
  it("calcula totales del home desde el ledger real", () => {
    const totals = customerPortalTotals(ledger());
    expect(totals).toEqual({ totalComprado: 30000, totalAbonado: 4800, movimientos: 3 });
    expect(customerPortalSummary(ledger()).debt).toBe(45200);
  });

  it("la ruta de perfil exige sesión de cliente", () => {
    expect(
      decideAuthGate({
        pathname: "/cliente/perfil",
        adminAuthenticated: true,
        adminBusinessId: "b1",
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "redirect", to: "/cliente/login" });
  });

  it("el chrome del portal muestra marca y navegación a perfil", () => {
    const chrome = src("src/components/customer/CustomerChrome.tsx");
    expect(chrome).toContain("/DulceCalle.png");
    expect(chrome).toContain("/cliente/perfil");
  });
});
