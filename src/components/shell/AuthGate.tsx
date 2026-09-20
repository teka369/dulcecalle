"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCustomerAuthSession } from "@/data/http/customer-session";
import { getPwaAuthSession } from "@/data/http/session";

export const ADMIN_PUBLIC = new Set(["/login", "/register", "/offline"]);

export function isCustomerPath(pathname: string): boolean {
  return pathname === "/cliente" || pathname.startsWith("/cliente/");
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (isCustomerPath(pathname)) {
      if (pathname === "/cliente/login") {
        setOk(true);
        return;
      }
      const customer = getCustomerAuthSession();
      if (!customer.authenticated) {
        router.replace("/cliente/login");
        return;
      }
      setOk(true);
      return;
    }

    const session = getPwaAuthSession();
    if (ADMIN_PUBLIC.has(pathname)) {
      setOk(true);
      return;
    }
    if (!session.authenticated) {
      router.replace("/login");
      return;
    }
    if (!session.businessId) {
      router.replace("/login");
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
