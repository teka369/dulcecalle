export const ADMIN_PUBLIC = new Set(["/login", "/register", "/offline", "/acceso-tienda"]);

export function isCustomerPath(pathname: string): boolean {
  return pathname === "/cliente" || pathname.startsWith("/cliente/");
}

export type AuthGateDecision =
  | { kind: "allow" }
  | { kind: "redirect"; to: "/login" | "/cliente/login" };

/**
 * Local-only. Does not fetch. NetworkError is not a logout signal.
 * Admin and customer sessions stay on separate storage keys.
 */
export function decideAuthGate(input: {
  pathname: string;
  adminAuthenticated: boolean;
  adminBusinessId: string | null;
  customerAuthenticated: boolean;
}): AuthGateDecision {
  if (isCustomerPath(input.pathname)) {
    if (input.pathname === "/cliente/login") return { kind: "allow" };
    if (!input.customerAuthenticated) {
      return { kind: "redirect", to: "/cliente/login" };
    }
    return { kind: "allow" };
  }
  if (ADMIN_PUBLIC.has(input.pathname)) return { kind: "allow" };
  if (!input.adminAuthenticated || !input.adminBusinessId) {
    return { kind: "redirect", to: "/login" };
  }
  return { kind: "allow" };
}
