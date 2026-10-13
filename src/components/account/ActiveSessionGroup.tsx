"use client";

import Link from "next/link";
import { ResetBusinessDataZone } from "./ResetBusinessDataZone";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { SectionHead } from "@/components/ui/SectionHead";

/** /login and /acceso-tienda with a store session: «Sesión activa / Negocio seleccionado» + Ir al inicio + danger zone. */
export function ActiveSessionGroup({
  email,
  hasBusiness,
  onLogout,
}: {
  email: string | null | undefined;
  hasBusiness: boolean;
  onLogout: () => void;
}) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionHead title="Sesión activa" />
        <RowGroup label="Sesión activa">
          <Row title={email ?? "Sesión activa"} meta={hasBusiness ? "Negocio seleccionado" : "Sesión en el servidor"} />
        </RowGroup>
      </section>
      <Link
        href="/"
        className="flex min-h-12 w-full items-center justify-center rounded-[var(--r-md)] bg-cta text-base font-semibold text-cta-fg"
      >
        Ir al inicio
      </Link>
      <button
        type="button"
        onClick={onLogout}
        className="flex min-h-11 w-full items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold text-ink"
      >
        Cerrar sesión
      </button>
      <details className="rounded-[var(--r-lg)] border border-danger/40 bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-danger">
          Zona de riesgo
        </summary>
        <div className="border-t border-border p-3">
          <ResetBusinessDataZone />
        </div>
      </details>
    </>
  );
}
