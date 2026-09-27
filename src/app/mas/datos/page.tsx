"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { resetPwaApi } from "@/data/pwa/api";
import { usePrep } from "@/store/prepStore";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function DatosPage() {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const { phase, lastReadyAt, start } = usePrep();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    try {
      setOnline(navigator.onLine);
    } catch {
      /* ignore */
    }
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

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
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Datos</h1>
      </header>

      <Card>
        <p className="font-semibold">El negocio vive en el servidor</p>
        <p className="mt-2 text-sm text-ink-muted">
          Ventas, fiados, caja e inventario se guardan en tu cuenta. Este
          teléfono solo guarda la sesión para no pedirte la clave a cada rato.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Si sales de la cuenta, los datos del negocio no se borran. Vuelves a
          entrar con el mismo correo.
        </p>
      </Card>

      <Card>
        <p className="font-semibold">Cerrar sesión en este teléfono</p>
        <p className="mt-2 text-sm text-ink-muted">
          Quita la sesión de aquí. No toca productos, ventas ni deudas.
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={() => void start()}
          disabled={!online}
          className="mt-4 w-full"
        >
          Actualizar preparación offline
        </Button>
        <p className="mt-2 text-xs text-ink-muted">
          {phase === "ready" && lastReadyAt
            ? `Dispositivo preparado el ${new Date(lastReadyAt).toLocaleString()}.`
            : "Prepara este dispositivo para trabajar sin conexión."}
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={onLogout}
          className="mt-4 w-full"
        >
          Cerrar sesión
        </Button>
      </Card>

      {done && (
        <p className="text-sm text-ink-muted">Sesión cerrada. Puedes entrar de nuevo.</p>
      )}
    </div>
  );
}
