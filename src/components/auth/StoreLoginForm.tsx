"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError } from "@/data/errors";
import { HttpRepository } from "@/data/http/repository";
import { getPwaAuthSession } from "@/data/http/session";
import { apiBaseUrl } from "@/data/backend";

export function StoreLoginForm() {
  const router = useRouter();
  const session = useMemo(() => getPwaAuthSession(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [memberships, setMemberships] = useState<
    Array<{ businessId: string; business: { name: string } }>
  >([]);

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
      router.replace("/");
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
    router.replace("/");
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <label className="text-sm font-medium" htmlFor="store-email">
          Correo
        </label>
        <input
          id="store-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          autoComplete="email"
          autoFocus
        />
        <label className="mt-4 block text-sm font-medium" htmlFor="store-password">
          Contraseña
        </label>
        <input
          id="store-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          autoComplete="current-password"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </section>

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
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSubmit()}
          className="min-h-12 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Entrando…" : "Entrar a la tienda"}
        </button>
      )}
    </div>
  );
}
