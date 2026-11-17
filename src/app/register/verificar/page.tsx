"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiError } from "@/data/errors";
import { apiBaseUrl } from "@/data/backend";
import { HttpRepository } from "@/data/http/repository";
import { getPwaAuthSession } from "@/data/http/session";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { Card } from "@/components/ui/Card";

function VerifyRegistration() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [message, setMessage] = useState("Confirmando tu correo…");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const base = apiBaseUrl();
    if (!base || token.length < 20) {
      setMessage("Este enlace no es válido. Pide otro desde el registro.");
      return;
    }
    const repo = new HttpRepository(base, getPwaAuthSession());
    let cancel = false;
    void repo.auth
      .verifyRegistration(token)
      .then(() => {
        if (cancel) return;
        setOk(true);
        setMessage(
          "Correo confirmado. Tu cuenta queda pendiente de aprobación y todavía no puedes entrar.",
        );
      })
      .catch((err: unknown) => {
        if (cancel) return;
        setOk(false);
        setMessage(
          err instanceof ApiError
            ? err.message
            : "No pudimos confirmar el correo. Inténtalo de nuevo en un momento.",
        );
      });
    return () => {
      cancel = true;
    };
  }, [token]);

  return (
    <Card>
      <p className="text-base font-semibold">{ok ? "Listo" : "Verificación"}</p>
      <p role="status" className="mt-2 text-sm text-ink-muted">
        {message}
      </p>
      <Link href="/register" className="mt-4 flex min-h-11 items-center text-sm font-semibold text-ink">
        Volver al registro
      </Link>
    </Card>
  );
}

export default function VerifyRegistrationPage() {
  return (
    <div className="flex flex-col">
      <HeroBlock size="medium" title="Confirmar correo" subtitle="Este paso no aprueba la cuenta." />
      <Sheet>
        <Suspense
          fallback={
            <p className="text-sm text-ink-muted">Confirmando tu correo…</p>
          }
        >
          <VerifyRegistration />
        </Suspense>
      </Sheet>
    </div>
  );
}
