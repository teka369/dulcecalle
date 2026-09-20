"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCustomerAuthSession } from "@/data/http/customer-session";
import { getPwaAuthSession } from "@/data/http/session";
import {
  ADMIN_PUBLIC,
  decideAuthGate,
  isCustomerPath,
} from "./auth-gate-decision";

export { ADMIN_PUBLIC, decideAuthGate, isCustomerPath };
export type { AuthGateDecision } from "./auth-gate-decision";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const admin = getPwaAuthSession();
    const customer = isCustomerPath(pathname)
      ? getCustomerAuthSession()
      : null;
    const decision = decideAuthGate({
      pathname,
      adminAuthenticated: admin.authenticated,
      adminBusinessId: admin.businessId,
      customerAuthenticated: customer?.authenticated ?? false,
    });
    if (decision.kind === "redirect") {
      router.replace(decision.to);
      return;
    }
    setOk(true);
  }, [pathname, router]);

  if (pathname === "/cliente/login" || ADMIN_PUBLIC.has(pathname)) {
    return children;
  }
  if (isCustomerPath(pathname) && !ok) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }
  if (ADMIN_PUBLIC.has(pathname)) return children;
  if (!ok) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }
  return children;
}
