"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/data/errors";
import { getCustomerApi } from "@/data/http/customer-api";
import { validateCustomerLoginInput } from "@/domain/customer-code";

export default function CustomerLoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (busy) return;
    setError(null);
    const parsed = validateCustomerLoginInput(code, name);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      await getCustomerApi().login(parsed.code, parsed.name);
      router.replace("/cliente");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "No pudimos identificarte.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold">Consulta como cliente</h1>
      <p className="text-sm text-ink/60">
        Entras solo a ver tu saldo y tus movimientos. No es el panel del
        negocio.
      </p>

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <label className="text-sm font-medium" htmlFor="codigo-cliente">
          Código de cliente
        </label>
        <input
          id="codigo-cliente"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          placeholder="DC-0001"
          autoComplete="off"
          autoFocus
        />
        <label className="mt-4 block text-sm font-medium" htmlFor="nombre-cliente">
          Nombre
        </label>
        <input
          id="nombre-cliente"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          autoComplete="name"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </section>

      <button
        type="button"
        disabled={busy}
        onClick={() => void onSubmit()}
        className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Consultando…" : "Consultar"}
      </button>

      <Link href="/login" className="text-center text-sm font-semibold text-ink">
        ← Volver
      </Link>
    </div>
  );
}
