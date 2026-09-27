"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError } from "@/data/errors";
import { HttpRepository } from "@/data/http/repository";
import { getPwaAuthSession } from "@/data/http/session";
import { apiBaseUrl } from "@/data/backend";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

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
      <Card>
        <label className="text-sm font-medium" htmlFor="store-email">
          Correo
        </label>
        <Input
          id="store-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2"
          autoComplete="email"
          autoFocus
        />
        <label className="mt-4 block text-sm font-medium" htmlFor="store-password">
          Contraseña
        </label>
        <Input
          id="store-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2"
          autoComplete="current-password"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </Card>

      {memberships.length > 0 ? (
        <Card>
          <p className="text-sm font-medium">Elige un negocio</p>
          <ul className="mt-3 flex flex-col gap-2">
            {memberships.map((m) => (
              <li key={m.businessId}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => pickBusiness(m.businessId)}
                  className="w-full"
                >
                  {m.business.name}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Button
          type="button"
          variant="primary"
          disabled={busy}
          onClick={() => void onSubmit()}
          className="min-h-12 w-full"
        >
          {busy ? "Entrando…" : "Entrar a la tienda"}
        </Button>
      )}
    </div>
  );
}
