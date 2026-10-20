"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getPwaAuthSession } from "@/data/http/session";
import { ActiveSessionGroup } from "@/components/account/ActiveSessionGroup";
import { StoreLoginForm } from "@/components/auth/StoreLoginForm";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { useHydrated } from "@/components/shell/use-online";

/**
 * loop/v1: the store owner entry is the primary path on /login. The customer
 * portal stays reachable as a secondary link to /cliente/login.
 */
export default function LoginPage() {
  const router = useRouter();
  const session = useMemo(() => getPwaAuthSession(), []);
  const secretTaps = useRef<number[]>([]);
  const [, setSessionRev] = useState(0);
  // The session lives in localStorage; SSR + hydration render signed-out, then the real state.
  const hydrated = useHydrated();
  const authenticated = hydrated && session.authenticated;

  // Hidden shortcut (restored from before 6edf276): 10 taps on the logo within 2.5 s → /acceso-tienda.
  function onLogoTap() {
    const now = Date.now();
    const taps = [...secretTaps.current, now].filter((at) => now - at <= 2500).slice(-10);
    secretTaps.current = taps;
    if (taps.length === 10) {
      secretTaps.current = [];
      router.push("/acceso-tienda");
    }
  }

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
          <button
            type="button"
            onClick={onLogoTap}
            aria-label="Dulce Calle"
            className="w-fit rounded-[var(--r-lg)] outline-none focus-visible:ring-2 focus-visible:ring-on-hero"
          >
            <Image
              src="/brand/dulcecalle-logo.png"
              alt="Dulce Calle"
              width={80}
              height={80}
              className="h-20 w-20 rounded-[var(--r-lg)] bg-surface object-contain"
              priority
            />
          </button>
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
