"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCustomerAuthSession } from "@/data/http/customer-session";
import { AUTH_CLEARED_EVENT, getPwaAuthSession } from "@/data/http/session";
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
    const check = () => {
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
        setOk(false);
        router.replace(decision.to);
        return;
      }
      setOk(true);
    };
    check();
    window.addEventListener(AUTH_CLEARED_EVENT, check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener(AUTH_CLEARED_EVENT, check);
      window.removeEventListener("storage", check);
    };
  }, [pathname, router]);

  if (pathname === "/cliente/login" || ADMIN_PUBLIC.has(pathname)) {
    return children;
  }
  if (isCustomerPath(pathname) && !ok) {
    return (
      <p className="rounded-[var(--r-md)] border border-border bg-surface px-3 py-2 text-sm text-ink-muted">
        Cargando…
      </p>
    );
  }
  if (ADMIN_PUBLIC.has(pathname)) return children;
  if (!ok) {
    return (
      <p className="rounded-[var(--r-md)] border border-border bg-surface px-3 py-2 text-sm text-ink-muted">
        Cargando…
      </p>
    );
  }
  return children;
}
