"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { ActiveSessionGroup } from "@/components/account/ActiveSessionGroup";
import { BrandLogo } from "@/components/account/BrandLogo";
import { StoreLoginForm } from "@/components/auth/StoreLoginForm";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { useHydrated } from "@/components/shell/use-online";

/**
 * loop/v1: the store owner entry is the primary path on /login. The customer
 * portal stays reachable as a secondary link to /cliente/login.
 */
export default function LoginPage() {
  const session = useMemo(() => getPwaAuthSession(), []);
  const [, setSessionRev] = useState(0);
  // The session lives in localStorage; SSR + hydration render signed-out, then the real state.
  const hydrated = useHydrated();
  const authenticated = hydrated && session.authenticated;

  function onLogout() {
    session.clear();
    setSessionRev((n) => n + 1);
  }

  return (
    <div className="flex flex-col">
      <HeroBlock
        size="tall"
        title={authenticated ? "Cuenta" : "Dulce Calle"}
        subtitle={authenticated ? undefined : "Entra para administrar tu tienda."}
      >
        <div className="mt-4">
          <BrandLogo />
        </div>
      </HeroBlock>
      <Sheet>
        {authenticated ? (
          <ActiveSessionGroup email={session.user?.email} hasBusiness={Boolean(session.businessId)} onLogout={onLogout} />
        ) : (
          <>
            <StoreLoginForm />
            <Link href="/cliente/login" className="flex min-h-11 items-center justify-center text-sm font-semibold text-ink">
              ¿Eres cliente? Consulta tu saldo
            </Link>
          </>
        )}
      </Sheet>
    </div>
  );
}
