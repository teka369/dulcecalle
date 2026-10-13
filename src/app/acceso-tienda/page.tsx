"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { StoreLoginForm } from "@/components/auth/StoreLoginForm";
import { ActiveSessionGroup } from "@/components/account/ActiveSessionGroup";
import { BrandLogo } from "@/components/account/BrandLogo";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";

export default function StoreLoginPage() {
  const session = useMemo(() => getPwaAuthSession(), []);
  const [, setRev] = useState(0);

  function onLogout() {
    session.clear();
    setRev((n) => n + 1);
  }

  return (
    <div className="flex flex-col">
      <HeroBlock
        size="tall"
        title={session.authenticated ? "Cuenta de tienda" : "Acceso de tienda"}
        subtitle={session.authenticated ? undefined : "Administración privada de tu negocio."}
      >
        <div className="mt-4">
          <BrandLogo />
        </div>
      </HeroBlock>
      <Sheet>
        {session.authenticated ? (
          <ActiveSessionGroup email={session.user?.email} hasBusiness={Boolean(session.businessId)} onLogout={onLogout} />
        ) : (
          <>
            <StoreLoginForm />
            <Link href="/login" className="flex min-h-11 items-center justify-center text-sm font-semibold text-ink">
              ← Volver al acceso de cliente
            </Link>
          </>
        )}
      </Sheet>
    </div>
  );
}
