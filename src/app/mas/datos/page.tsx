"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { resetPwaApi } from "@/data/pwa/api";
import { usePrep } from "@/store/prepStore";

export default function DatosPage() {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const { phase, lastReadyAt, start } = usePrep();

  function onLogout() {
    getPwaAuthSession().clear();
    resetPwaApi();
    setDone(true);
    router.replace("/login");
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/mas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Datos</h1>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <p className="font-semibold">El negocio vive en el servidor</p>
        <p className="mt-2 text-sm text-ink/70">
          Ventas, fiados, caja e inventario se guardan en tu cuenta. Este
          teléfono solo guarda la sesión para no pedirte la clave a cada rato.
        </p>
        <p className="mt-2 text-sm text-ink/70">
          Si sales de la cuenta, los datos del negocio no se borran. Vuelves a
          entrar con el mismo correo.
        </p>
      </section>

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <p className="font-semibold">Cerrar sesión en este teléfono</p>
        <p className="mt-2 text-sm text-ink/70">
          Quita la sesión de aquí. No toca productos, ventas ni deudas.
        </p>
        <button
          type="button"
          onClick={() => void start()}
          className="mt-4 min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white"
        >
          Actualizar preparación offline
        </button>
        <p className="mt-2 text-xs text-ink/60">
          {phase === "ready" && lastReadyAt
            ? `Dispositivo preparado el ${new Date(lastReadyAt).toLocaleString()}.`
            : "Prepara este dispositivo para trabajar sin conexión."}
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-4 min-h-11 w-full rounded-[14px] border border-ink/10 bg-surface text-sm font-semibold"
        >
          Cerrar sesión
        </button>
      </section>

      {done && (
        <p className="text-sm text-ink/70">Sesión cerrada. Puedes entrar de nuevo.</p>
      )}
    </div>
  );
}
