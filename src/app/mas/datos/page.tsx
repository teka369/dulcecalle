"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { getPwaApi, resetPwaApi } from "@/data/pwa/api";
import { usePrep } from "@/store/prepStore";
import { Button } from "@/components/ui/Button";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";

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

  async function onLogout() {
    try {
      await getPwaApi().auth.logout();
    } catch {
      getPwaAuthSession().clear();
    }
    resetPwaApi();
    setDone(true);
    router.replace("/login");
  }

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="compact"
        back={{ href: "/mas", label: "Volver a Más" }}
        title="Datos"
        subtitle="El negocio vive en el servidor y en este teléfono"
      />
      <Sheet>
        <p className="text-sm text-ink-muted">
          Ventas, fiados, caja e inventario que ya se enviaron quedan en tu cuenta.
          Este teléfono también guarda una copia para trabajar sin conexión y las operaciones que todavía no se han enviado.
          Si sales de la cuenta, lo que ya está en el servidor no se borra. Cerrar sesión tampoco borra esa copia local.
        </p>
        <RowGroup label="Almacenamiento">
          <Row href="/sincronizacion" title="Ver almacenamiento de este teléfono" />
        </RowGroup>

        <section className="flex flex-col gap-2">
          <SectionHead title="Sin conexión" />
          <div className="rounded-[var(--r-lg)] border border-border bg-surface p-3">
            <p className="text-sm font-medium text-ink">Preparar este dispositivo para trabajar sin conexión</p>
            <p className="mt-1 text-xs text-ink-muted">
              {phase === "ready" && lastReadyAt
                ? `Dispositivo preparado el ${new Date(lastReadyAt).toLocaleString()}.`
                : "Prepara este dispositivo para trabajar sin conexión."}
            </p>
            <Button
              type="button"
              variant="primary"
              onClick={() => void start({ refresh: true })}
              disabled={!online}
              className="mt-3 w-full"
            >
              Actualizar preparación offline
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-2" aria-label="Sesión">
          <div className="rounded-[var(--r-lg)] border border-danger/30 bg-surface p-3">
            <p className="text-sm font-semibold text-ink">Cerrar sesión en este teléfono</p>
            <p className="mt-1 text-sm text-ink-muted">Quita la sesión de aquí. No toca productos, ventas ni deudas.</p>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="mt-3 flex min-h-11 w-full items-center justify-center rounded-[var(--r-md)] border border-danger bg-surface text-sm font-semibold text-danger"
            >
              Cerrar sesión
            </button>
          </div>
          {done && (
            <p role="status" className="text-sm text-ink-muted">
              Sesión cerrada. Puedes entrar de nuevo.
            </p>
          )}
        </section>
      </Sheet>
    </div>
  );
}
