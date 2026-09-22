"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiBaseUrl } from "@/data/backend";
import { ApiError } from "@/data/errors";
import { HttpRepository } from "@/data/http/repository";
import { getPwaAuthSession } from "@/data/http/session";
import { ResetBusinessDataZone } from "@/components/account/ResetBusinessDataZone";

export default function LoginPage() {
  const router = useRouter();
  const session = useMemo(() => getPwaAuthSession(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [memberships, setMemberships] = useState<
    Array<{ businessId: string; business: { name: string } }>
  >([]);
  const [, setSessionRev] = useState(0);

  const loggedIn = session.authenticated;

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
      const result = await repo.auth.login(email, password);
      if (result.memberships.length > 1 && !session.businessId) {
        setMemberships(
          result.memberships.map((m) => ({
            businessId: m.businessId,
            business: { name: m.business.name },
          })),
        );
        setBusy(false);
        return;
      }
      router.push("/");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "No pudimos entrar.",
      );
      setBusy(false);
    }
  }

  function pickBusiness(businessId: string) {
    session.selectBusiness(businessId);
    router.push("/");
  }

  function onLogout() {
    session.clear();
    setMemberships([]);
    setEmail("");
    setPassword("");
    setError(null);
    setSessionRev((n) => n + 1);
  }

  if (loggedIn && memberships.length === 0) {
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
      <Image
        src="/DulceCalle.png"
        alt="Dulce Calle"
        width={80}
        height={80}
        className="h-20 w-20 rounded-2xl object-cover"
        priority
      />
      <h1 className="text-[22px] font-semibold">Dulce Calle</h1>
      <p className="text-sm text-ink/60">
        Consulta tu saldo y tus movimientos.
      </p>

      <section className="rounded-2xl border border-cta/30 bg-surface p-4">
        <p className="text-base font-semibold">Entrar como Cliente</p>
        <p className="mt-1 text-sm text-ink/60">
          Mira cuánto debes, tus compras y tus abonos.
        </p>
        <Link
          href="/cliente/login"
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-[14px] bg-cta px-4 text-base font-semibold text-white"
        >
          Entrar como Cliente
        </Link>
      </section>

      <h2 className="mt-2 text-base font-semibold text-ink/70">
        Entrar a mi tienda
      </h2>
      <p className="-mt-2 text-sm text-ink/60">
        Entras al negocio en el servidor. Los datos viven allá, no en este
        teléfono.
      </p>

      {memberships.length > 0 ? (
        <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
          <p className="text-sm font-medium">Elige un negocio</p>
          <ul className="mt-3 flex flex-col gap-2">
            {memberships.map((m) => (
              <li key={m.businessId}>
                <button
                  type="button"
                  onClick={() => pickBusiness(m.businessId)}
                  className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white"
                >
                  {m.business.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
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
            autoComplete="current-password"
          />
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </section>
      )}

      {memberships.length === 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSubmit()}
          className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
        >
          Entrar
        </button>
      )}

    </div>
  );
}
