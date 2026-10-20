"use client";

import { useState } from "react";
import { apiBaseUrl } from "@/data/backend";
import { NetworkError } from "@/data/errors";
import { HttpRepository } from "@/data/http/repository";
import { getPwaAuthSession } from "@/data/http/session";
import { clearLocalBusinessData } from "@/data/pwa/business-reset";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export const RESET_CONFIRM_PHRASE = "ELIMINAR DATOS";

/** Must match the `deleted` keys returned by DELETE /business/data. */
export const RESET_ENTITY_LABELS: Record<string, string> = {
  saleReturnLines: "Líneas de devolución",
  saleReturns: "Devoluciones",
  saleLines: "Líneas de venta",
  sales: "Ventas",
  customerPayments: "Abonos",
  initialDebts: "Deudas iniciales",
  stockMoves: "Movimientos de inventario",
  cashMoves: "Movimientos de caja",
  cashSessions: "Sesiones de caja",
  expenses: "Gastos",
  customers: "Clientes",
  suppliers: "Proveedores",
  products: "Productos",
  productImages: "Imágenes de productos",
  preparations: "Preparaciones",
  settings: "Ajustes del negocio",
  importIdMap: "Mapa de importación",
};

type Step = "idle" | "warn" | "confirm" | "running" | "done" | "error";

function entityList(): string[] {
  return Object.values(RESET_ENTITY_LABELS).map((label) => `• ${label}`);
}

export function ResetBusinessDataZone() {
  const [step, setStep] = useState<Step>("idle");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Record<string, number> | null>(null);
  const [serverDone, setServerDone] = useState(false);

  function cancel() {
    if (busy) return;
    setStep("idle");
    setPhrase("");
    setError(null);
    setServerDone(false);
  }

  async function execute() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("Necesitas conexión a internet para eliminar los datos del negocio.");
      }
      const session = getPwaAuthSession();
      const businessId = session.businessId;
      if (!businessId) throw new Error("Selecciona un negocio primero.");
      const base = apiBaseUrl();
      if (!base) throw new Error("El servidor no está configurado.");
      const repo = new HttpRepository(base, session);
      setStep("running");
      const result = await repo.business.resetData();
      setServerDone(true);
      setDeleted(result.deleted);
      // Server wiped first; now mirror locally so nothing resurrects:
      // pending outbox ops included, so they can never re-create rows.
      // Only the wiped business' portal snapshots are invalidated.
      await clearLocalBusinessData(businessId, {
        customerIds: result.deletedCustomerIds ?? [],
      });
      setStep("done");
    } catch (e) {
      if (e instanceof NetworkError) {
        setError("Necesitas conexión a internet para eliminar los datos del negocio.");
      } else {
        setError(e instanceof Error ? e.message : "No se pudieron eliminar los datos.");
      }
      setStep("error");
    } finally {
      setBusy(false);
    }
  }

  if (step === "idle") {
    return (
      <Card className="border border-danger/20">
        <p className="text-sm font-semibold text-danger">Zona peligrosa</p>
        <p className="mt-1 text-sm text-ink-muted">
          Elimina los datos de prueba del negocio actual. Tu cuenta no será
          eliminada.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setStep("warn")}
          className="mt-3 w-full border-danger/30 text-danger"
        >
          Eliminar datos del negocio
        </Button>
      </Card>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-ink/45 px-5 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-title"
    >
      <div className="w-full max-w-sm rounded-[var(--r-lg)] border border-border bg-surface p-5 shadow-[var(--shadow-lg)]">
        {step === "warn" && (
          <>
            <h2 id="reset-title" className="text-base font-semibold">
              Eliminar datos del negocio
            </h2>
            <p className="mt-1 text-sm leading-snug text-ink-muted">
              Esta acción eliminará los datos y operaciones del negocio
              actual.
            </p>
            <p className="mt-3 text-sm font-medium">Se eliminarán:</p>
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm text-ink-muted">
              {entityList().map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm font-medium">
              La cuenta del usuario NO será eliminada.
            </p>
            <p className="mt-1 text-sm font-semibold text-danger">
              Esta acción no se puede deshacer.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={cancel} className="w-full">
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={() => setStep("confirm")} className="w-full">
                Continuar
              </Button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <h2 id="reset-title" className="text-base font-semibold">
              Confirmación final
            </h2>
            <p className="mt-1 text-sm leading-snug text-ink-muted">
              Para continuar escribe exactamente:
            </p>
            <p className="mt-2 rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-center text-sm font-bold tracking-wide">
              {RESET_CONFIRM_PHRASE}
            </p>
            <label className="mt-3 block text-sm font-medium" htmlFor="reset-phrase">
              Frase de confirmación
            </label>
            <Input
              id="reset-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={RESET_CONFIRM_PHRASE}
              autoComplete="off"
              className="mt-2 focus-visible:ring-danger"
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={cancel} disabled={busy} className="w-full">
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void execute()}
                disabled={busy || phrase.trim() !== RESET_CONFIRM_PHRASE}
                className="w-full"
              >
                Eliminar definitivamente
              </Button>
            </div>
          </>
        )}

        {step === "running" && (
          <>
            <h2 id="reset-title" className="text-base font-semibold">
              Eliminando datos…
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Borrando datos del negocio en el servidor y en este
              dispositivo. No cierres la aplicación.
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-danger" />
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h2 id="reset-title" className="text-base font-semibold">
              ✓ Datos eliminados
            </h2>
            <p className="mt-1 text-sm leading-snug text-ink-muted">
              Los datos de prueba del negocio fueron eliminados
              correctamente. Tu cuenta y acceso siguen intactos.
            </p>
            {deleted && (
              <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto text-xs text-ink-muted">
                {Object.entries(deleted).map(([key, count]) => (
                  <li key={key}>
                    ✓ {RESET_ENTITY_LABELS[key] ?? key}: {count}
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="primary"
              onClick={() => window.location.replace("/")}
              className="mt-4 w-full"
            >
              Volver al inicio
            </Button>
          </>
        )}

        {step === "error" && (
          <>
            <h2 id="reset-title" className="text-base font-semibold">
              No se pudieron eliminar los datos
            </h2>
            <p className="mt-1 text-sm leading-snug text-ink-muted">
              {error ?? "Ocurrió un error inesperado."}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {serverDone
                ? "El servidor ya quedó limpio, pero este dispositivo no terminó de actualizarse. Vuelve a intentarlo con conexión estable."
                : "El servidor revierte la operación completa si algo falla a la mitad. No se aplicaron cambios. Vuelve a intentarlo con conexión estable."}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={cancel} className="w-full">
                Cerrar
              </Button>
              <Button type="button" variant="primary" onClick={() => void execute()} className="w-full">
                Reintentar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
