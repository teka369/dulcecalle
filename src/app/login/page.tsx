"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPwaAuthSession } from "@/data/http/session";
import { ResetBusinessDataZone } from "@/components/account/ResetBusinessDataZone";
import { CustomerLoginForm } from "@/components/customer/CustomerLoginForm";

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
          src="/DulceCalle.png"
          alt="Dulce Calle"
          width={80}
          height={80}
          className="h-20 w-20 rounded-2xl object-cover"
          priority
        />
        <h1 className="text-[22px] font-semibold">Cuenta</h1>
        <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
          <p className="text-sm text-ink/70">Sesión en el servidor</p>
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
      <button
        type="button"
        onClick={onLogoTap}
        aria-label="Dulce Calle"
        className="w-fit rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-cta/50"
      >
        <Image
          src="/DulceCalle.png"
          alt="Dulce Calle"
          width={80}
          height={80}
          className="h-20 w-20 rounded-2xl object-cover"
          priority
        />
      </button>

      <div>
        <h1 className="text-[22px] font-semibold">Dulce Calle</h1>
        <p className="mt-1 text-sm text-ink/60">
          Consulta tu saldo y tus movimientos.
        </p>
      </div>

      <CustomerLoginForm />
    </div>
  );
}
