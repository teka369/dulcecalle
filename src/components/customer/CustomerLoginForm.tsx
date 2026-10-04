"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/data/errors";
import { getCustomerApi } from "@/data/http/customer-api";
import { validateCustomerLoginInput } from "@/domain/customer-code";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export function CustomerLoginForm({ showBack = false }: { showBack?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (busy) return;
    setError(null);
    const parsed = validateCustomerLoginInput(code, pin);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      await getCustomerApi().login(parsed.code, parsed.pin);
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
      <div>
        <h1 className="text-[22px] font-semibold">Consulta como cliente</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Consulta tu saldo, compras y abonos.
        </p>
      </div>

      <Card>
        <label className="text-sm font-medium" htmlFor="codigo-cliente">
          Código de cliente
        </label>
        <Input
          id="codigo-cliente"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-2"
          autoComplete="off"
          autoFocus
        />
        <label className="mt-4 block text-sm font-medium" htmlFor="pin-cliente">
          PIN
        </label>
        <Input
          id="pin-cliente"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="mt-2"
          inputMode="numeric"
          autoComplete="off"
          type="password"
          maxLength={6}
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </Card>

      <Button
        type="button"
        variant="primary"
        disabled={busy}
        onClick={() => void onSubmit()}
        className="min-h-12 w-full"
      >
        {busy ? "Consultando…" : "Consultar saldo"}
      </Button>

      {showBack && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push("/login")}
          className="w-full"
        >
          ← Volver
        </Button>
      )}
    </div>
  );
}
