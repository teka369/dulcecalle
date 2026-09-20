import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

import { ADMIN_PUBLIC, isCustomerPath } from "./AuthGate";

describe("customer portal routing", () => {
  it("treats /cliente as customer and /clientes as admin", () => {
    expect(isCustomerPath("/cliente")).toBe(true);
    expect(isCustomerPath("/cliente/login")).toBe(true);
    expect(isCustomerPath("/cliente/compras/abc")).toBe(true);
    expect(isCustomerPath("/clientes")).toBe(false);
    expect(isCustomerPath("/clientes/abc")).toBe(false);
    expect(isCustomerPath("/login")).toBe(false);
    expect(isCustomerPath("/")).toBe(false);
  });

  it("keeps admin login/register public and customer login public", () => {
    expect(ADMIN_PUBLIC.has("/login")).toBe(true);
    expect(ADMIN_PUBLIC.has("/register")).toBe(true);
    expect(ADMIN_PUBLIC.has("/cliente")).toBe(false);
    expect(ADMIN_PUBLIC.has("/cliente/login")).toBe(false);
  });

  it("admin login offers ¿Eres cliente? toward /cliente/login", () => {
    const src = readFileSync(join(__dirname, "../../app/login/page.tsx"), "utf8");
    expect(src).toContain("¿Eres cliente?");
    expect(src).toContain('href="/cliente/login"');
  });

  it("customer login is a code+name form with volver", () => {
    const src = readFileSync(
      join(__dirname, "../../app/cliente/login/page.tsx"),
      "utf8",
    );
    expect(src).toContain("Consulta como cliente");
    expect(src).toContain("Código de cliente");
    expect(src).toContain("Nombre");
    expect(src).toContain("Consultar");
    expect(src).toContain("Consultando…");
    expect(src).toContain("← Volver");
    expect(src).toContain("validateCustomerLoginInput");
  });

  it("portal pages load ledger from the server and have empty/error copy", () => {
    const home = readFileSync(
      join(__dirname, "../../app/cliente/page.tsx"),
      "utf8",
    );
    expect(home).toContain("Hola, {summary.name}");
    expect(home).toContain("Saldo pendiente");
    expect(home).toContain("summary.debt");
    expect(home).toContain("Cargando…");
    expect(home).toContain("getCustomerApi");

    const compras = readFileSync(
      join(__dirname, "../../app/cliente/compras/page.tsx"),
      "utf8",
    );
    expect(compras).toContain("Todavía no hay compras a tu nombre.");

    const chrome = readFileSync(
      join(__dirname, "../customer/CustomerChrome.tsx"),
      "utf8",
    );
    expect(chrome).toContain("Salir");
    expect(chrome).toContain("logout");
    expect(chrome).toContain('router.replace("/cliente/login")');
  });
});
