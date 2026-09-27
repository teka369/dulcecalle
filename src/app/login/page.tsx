"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPwaAuthSession } from "@/data/http/session";
import { ResetBusinessDataZone } from "@/components/account/ResetBusinessDataZone";
import { CustomerLoginForm } from "@/components/customer/CustomerLoginForm";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function LoginPage() {
  const router = useRouter();
  const session = useMemo(() => getPwaAuthSession(), []);
  const secretTaps = useRef<number[]>([]);
  const [, setSessionRev] = useState(0);

  function onLogoTap() {
    const now = Date.now();
    const taps = [...secretTaps.current, now]
      .filter((at) => now - at <= 2500)
      .slice(-10);
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

  if (session.authenticated) {
    return (
      <div className="flex flex-col gap-4">
        <Image
          src="/brand/dulcecalle-logo.png"
          alt="Dulce Calle"
          width={80}
          height={80}
          className="h-20 w-20 rounded-[var(--r-lg)] object-contain"
          priority
        />
        <h1 className="text-[22px] font-semibold">Cuenta</h1>
        <Card>
          <p className="text-sm text-ink-muted">Sesión en el servidor</p>
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
      <button
        type="button"
        onClick={onLogoTap}
        aria-label="Dulce Calle"
        className="w-fit rounded-[var(--r-lg)] outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Image
          src="/brand/dulcecalle-logo.png"
          alt="Dulce Calle"
          width={80}
          height={80}
          className="h-20 w-20 rounded-[var(--r-lg)] object-contain"
          priority
        />
      </button>

      <div>
        <h1 className="text-[22px] font-semibold">Dulce Calle</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Consulta tu saldo y tus movimientos.
        </p>
      </div>

      <CustomerLoginForm />
    </div>
  );
}
