"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { StoreLoginForm } from "@/components/auth/StoreLoginForm";
import { ResetBusinessDataZone } from "@/components/account/ResetBusinessDataZone";

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
          src="/DulceCalle.png"
          alt="Dulce Calle"
          width={72}
          height={72}
          className="h-[72px] w-[72px] rounded-2xl object-cover"
          priority
        />
        <h1 className="text-[22px] font-semibold">Cuenta de tienda</h1>
        <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
          <p className="text-sm text-ink/70">Sesión activa</p>
          <p className="mt-1 text-base font-semibold">
            {session.user?.email ?? "Sesión activa"}
          </p>
          {session.businessId && (
            <p className="mt-2 text-sm text-ink/60">Negocio seleccionado</p>
          )}
        </section>
        <button
          type="button"
          onClick={onLogout}
          className="min-h-11 w-full rounded-[14px] border border-ink/10 bg-surface text-sm font-semibold"
        >
          Cerrar sesión
        </button>
        <ResetBusinessDataZone />
        <Link href="/" className="text-center text-sm text-ink/60">
          Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Image
        src="/DulceCalle.png"
        alt="Dulce Calle"
        width={72}
        height={72}
        className="h-[72px] w-[72px] rounded-2xl object-cover"
        priority
      />
      <div>
        <h1 className="text-[22px] font-semibold">Acceso de tienda</h1>
        <p className="mt-1 text-sm text-ink/60">
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
