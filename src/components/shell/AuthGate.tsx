"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";

const PUBLIC = new Set(["/login", "/register", "/offline"]);

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const session = getPwaAuthSession();
    if (PUBLIC.has(pathname)) {
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

  if (PUBLIC.has(pathname)) return children;
  if (!ok) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }
  return children;
}
