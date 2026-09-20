import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

import { ADMIN_PUBLIC, decideAuthGate, isCustomerPath } from "./AuthGate";
import { CustomerSession } from "@/data/http/customer-session";
import { HttpSession, type AuthStorage } from "@/data/http/session";

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

  it("decideAuthGate is local-only: NetworkError is not a logout", () => {
    const signedIn = {
      adminAuthenticated: true,
      adminBusinessId: "biz-a",
      customerAuthenticated: false,
    };
    expect(decideAuthGate({ pathname: "/", ...signedIn })).toEqual({
      kind: "allow",
    });
    expect(
      decideAuthGate({
        pathname: "/",
        adminAuthenticated: false,
        adminBusinessId: null,
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "redirect", to: "/login" });
    expect(
      decideAuthGate({
        pathname: "/",
        adminAuthenticated: true,
        adminBusinessId: null,
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "redirect", to: "/login" });
    expect(
      decideAuthGate({
        pathname: "/login",
        adminAuthenticated: false,
        adminBusinessId: null,
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      decideAuthGate({
        pathname: "/cliente",
        adminAuthenticated: true,
        adminBusinessId: "biz-a",
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "redirect", to: "/cliente/login" });
    expect(
      decideAuthGate({
        pathname: "/cliente",
        adminAuthenticated: false,
        adminBusinessId: null,
        customerAuthenticated: true,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      decideAuthGate({
        pathname: "/",
        adminAuthenticated: false,
        adminBusinessId: null,
        customerAuthenticated: true,
      }),
    ).toEqual({ kind: "redirect", to: "/login" });
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

function memoryStorage(): AuthStorage {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function unsignedJwt(payload: Record<string, unknown>): string {
  const b64url = (value: string) =>
    Buffer.from(value, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(payload))}.sig`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("AuthGate vs refresh exp", () => {
  it("expired admin refresh → redirect to /login", () => {
    const session = new HttpSession(memoryStorage());
    session.accessToken = unsignedJwt({ exp: nowSec() + 900 });
    session.refreshToken = unsignedJwt({ exp: nowSec() - 60 });
    session.businessId = "biz-a";
    expect(
      decideAuthGate({
        pathname: "/",
        adminAuthenticated: session.authenticated,
        adminBusinessId: session.businessId,
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "redirect", to: "/login" });
  });

  it("valid admin refresh + expired access → allow", () => {
    const session = new HttpSession(memoryStorage());
    session.accessToken = unsignedJwt({ exp: nowSec() - 60 });
    session.refreshToken = unsignedJwt({ exp: nowSec() + 7 * 24 * 3600 });
    session.businessId = "biz-a";
    expect(
      decideAuthGate({
        pathname: "/",
        adminAuthenticated: session.authenticated,
        adminBusinessId: session.businessId,
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("expired customer refresh → redirect to /cliente/login", () => {
    const session = new CustomerSession(memoryStorage());
    session.accessToken = unsignedJwt({
      typ: "customer",
      exp: nowSec() + 900,
    });
    session.refreshToken = unsignedJwt({
      typ: "customer_refresh",
      exp: nowSec() - 60,
    });
    expect(
      decideAuthGate({
        pathname: "/cliente",
        adminAuthenticated: false,
        adminBusinessId: null,
        customerAuthenticated: session.authenticated,
      }),
    ).toEqual({ kind: "redirect", to: "/cliente/login" });
  });

  it("valid customer refresh + expired access → allow", () => {
    const session = new CustomerSession(memoryStorage());
    session.accessToken = unsignedJwt({
      typ: "customer",
      exp: nowSec() - 60,
    });
    session.refreshToken = unsignedJwt({
      typ: "customer_refresh",
      exp: nowSec() + 7 * 24 * 3600,
    });
    expect(
      decideAuthGate({
        pathname: "/cliente",
        adminAuthenticated: false,
        adminBusinessId: null,
        customerAuthenticated: session.authenticated,
      }),
    ).toEqual({ kind: "allow" });
  });
});
