"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { StoreLoginForm } from "@/components/auth/StoreLoginForm";
import { ResetBusinessDataZone } from "@/components/account/ResetBusinessDataZone";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function StoreLoginPage() {
  const session = useMemo(() => getPwaAuthSession(), []);
  const [, setRev] = useState(0);

  function onLogout() {
    session.clear();
    setRev((n) => n + 1);
  }

  if (session.authenticated) {
    return (
      <div className="flex flex-col gap-4">
        <Image
          src="/brand/dulcecalle-logo.png"
          alt="Dulce Calle"
          width={72}
          height={72}
          className="h-[72px] w-[72px] rounded-[var(--r-lg)] object-contain"
          priority
        />
        <h1 className="text-[22px] font-semibold">Cuenta de tienda</h1>
        <Card>
          <p className="text-sm text-ink-muted">Sesión activa</p>
          <p className="mt-1 text-base font-semibold">
            {session.user?.email ?? "Sesión activa"}
          </p>
          {session.businessId && (
            <p className="mt-2 text-sm text-ink-muted">Negocio seleccionado</p>
          )}
        </Card>
        <Button type="button" variant="secondary" onClick={onLogout} className="w-full">
          Cerrar sesión
        </Button>
        <ResetBusinessDataZone />
        <Link href="/" className="text-center text-sm text-ink-muted">
          Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Image
        src="/brand/dulcecalle-logo.png"
        alt="Dulce Calle"
        width={72}
        height={72}
        className="h-[72px] w-[72px] rounded-[var(--r-lg)] object-contain"
        priority
      />
      <div>
        <h1 className="text-[22px] font-semibold">Acceso de tienda</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Administración privada de tu negocio.
        </p>
      </div>
      <StoreLoginForm />
      <Link href="/login" className="text-center text-sm font-semibold text-ink">
        ← Volver al acceso de cliente
      </Link>
    </div>
  );
}
