"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPwaAuthSession } from "@/data/http/session";
import { ActiveSessionGroup } from "@/components/account/ActiveSessionGroup";
import Image from "next/image";
import { CustomerLoginForm } from "@/components/customer/CustomerLoginForm";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";

export default function LoginPage() {
  const router = useRouter();
  const session = useMemo(() => getPwaAuthSession(), []);
  const secretTaps = useRef<number[]>([]);
  const [, setSessionRev] = useState(0);

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
      <HeroBlock size="tall" title={session.authenticated ? "Cuenta" : "Dulce Calle"} subtitle={session.authenticated ? undefined : "Consulta tu saldo y tus movimientos."}>
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
        {session.authenticated ? (
          <ActiveSessionGroup email={session.user?.email} hasBusiness={Boolean(session.businessId)} onLogout={onLogout} />
        ) : (
          <CustomerLoginForm />
        )}
      </Sheet>
    </div>
  );
}
