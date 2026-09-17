"use client";

import Link from "next/link";
import { useState } from "react";
import { isDbEmpty, wipeLocalData } from "@/storage/seed";

const CONFIRM_WORD = "BORRAR";

export default function DatosPage() {
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canProceed = typed.trim().toUpperCase() === CONFIRM_WORD;

  async function onWipe() {
    if (!canProceed || busy) return;
    if (step === "form") {
      setStep("confirm");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await wipeLocalData();
      const empty = await isDbEmpty();
      if (!empty) throw new Error("No se pudieron borrar los datos.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al borrar");
      setBusy(false);
      setStep("form");
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/mas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Datos</h1>
      </header>

      {done ? (
        <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
          <p className="font-semibold">Datos locales eliminados</p>
          <p className="mt-2 text-sm text-ink/70">
            Este dispositivo quedó vacío. Puedes cargar la demo otra vez desde
            Inicio.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex min-h-11 items-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
          >
            Ir a Inicio
          </Link>
        </section>
      ) : (
        <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
          <p className="font-semibold">Limpiar datos / Reiniciar</p>
          <p className="mt-2 text-sm text-ink/70">
            Esto borra ventas, fiados, caja, inventario y la demo de{" "}
            <strong>este dispositivo</strong>. No se puede deshacer. No toca
            ningún servidor — todo vive en el navegador.
          </p>

          <label className="mt-4 block text-sm font-medium" htmlFor="confirm">
            Escribe {CONFIRM_WORD} para continuar
          </label>
          <input
            id="confirm"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setStep("form");
            }}
            autoComplete="off"
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
            placeholder={CONFIRM_WORD}
          />

          {step === "confirm" && (
            <p className="mt-3 text-sm font-medium text-danger">
              ¿Seguro? Se van a borrar todos los datos locales.
            </p>
          )}

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </section>
      )}

      {!done && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <button
              type="button"
              disabled={!canProceed || busy}
              onClick={() => void onWipe()}
              className="min-h-11 w-full rounded-[14px] bg-danger text-sm font-semibold text-white disabled:opacity-40"
            >
              {step === "form"
                ? "Eliminar datos locales"
                : "Sí, borrar todo"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
