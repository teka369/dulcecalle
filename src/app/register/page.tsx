"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiBaseUrl } from "@/data/backend";
import { ApiError } from "@/data/errors";
import { HttpRepository } from "@/data/http/repository";
import { getPwaAuthSession } from "@/data/http/session";

export default function RegisterPage() {
  const router = useRouter();
  const session = useMemo(() => getPwaAuthSession(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (busy) return;
    setError(null);
    const base = apiBaseUrl();
    if (!base) {
      setError("El servidor no está configurado.");
      return;
    }
    setBusy(true);
    try {
      const repo = new HttpRepository(base, session);
      await repo.auth.register({
        email,
        password,
        ...(businessName.trim() ? { businessName: businessName.trim() } : {}),
      });
      router.push("/");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "No pudimos crear la cuenta.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold">Crear cuenta</h1>
      <p className="text-sm text-ink/60">
        Crea el negocio en el servidor. Puedes cargar productos, clientes y
        fiados a mano.
      </p>

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <label className="text-sm font-medium" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          autoComplete="email"
          autoFocus
        />
        <label className="mt-4 block text-sm font-medium" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-ink/50">Mínimo 8 caracteres.</p>
        <label className="mt-4 block text-sm font-medium" htmlFor="negocio">
          Nombre del negocio
        </label>
        <input
          id="negocio"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          placeholder="Opcional"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </section>

      <button
        type="button"
        disabled={busy}
        onClick={() => void onSubmit()}
        className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
      >
        Crear cuenta
      </button>

      <p className="text-center text-sm text-ink/60">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-semibold text-ink">
          Entrar
        </Link>
      </p>
    </div>
  );
}
