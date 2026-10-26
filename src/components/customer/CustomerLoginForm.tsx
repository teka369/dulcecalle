"use client";

import { errorText } from "@/domain/ux/user-message";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "@/data/errors";
import { getCustomerApi } from "@/data/http/customer-api";
import { validateCustomerLoginInput } from "@/domain/customer-code";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function CustomerLoginForm({ showBack = false }: { showBack?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  // Store link (/cliente/login?tienda=<businessId>) pins the store. Without
  // it, after a failed attempt we offer ONE optional free-text store field
  // (short name or store code). We never list stores: the API gives the same
  // generic error for a wrong PIN, an unknown code or a code in 2+ stores.
  const [linkBusinessId, setLinkBusinessId] = useState<string | null>(null);
  const [askStore, setAskStore] = useState(false);
  const [store, setStore] = useState("");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tienda")?.trim();
    if (t && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) setLinkBusinessId(t);
  }, []);

  function fail(message: string) {
    setError(message);
    setBusy(false);
    requestAnimationFrame(() => codeRef.current?.focus());
  }

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setError(null);
    const parsed = validateCustomerLoginInput(code, pin);
    if ("error" in parsed) {
      fail(parsed.error);
      return;
    }
    setBusy(true);
    try {
      await getCustomerApi().login(
        parsed.code,
        parsed.pin,
        linkBusinessId ?? undefined,
        linkBusinessId ? undefined : store,
      );
      router.replace("/cliente");
    } catch (e) {
      if (!linkBusinessId && e instanceof ApiError && e.status === 401) setAskStore(true);
      fail(errorText(e, "No pudimos identificarte."));
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
      <div>
        <h2 className="text-[22px] font-semibold">Consulta como cliente</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Consulta tu saldo, compras y abonos.
        </p>
      </div>

      {/* Fields sit directly on the sheet (no nested card). */}
      <div data-testid="login-fields">
        <label className="text-sm font-medium" htmlFor="codigo-cliente">
          Código de cliente
        </label>
        <Input
          id="codigo-cliente"
          ref={codeRef}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "customer-login-error" : undefined}
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
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "customer-login-error" : undefined}
          className="mt-2"
          inputMode="numeric"
          autoComplete="off"
          type="password"
          maxLength={6}
        />
        {askStore && !linkBusinessId && (
          <>
            <label className="mt-4 block text-sm font-medium" htmlFor="tienda-cliente">
              Tienda (si compras en más de una)
            </label>
            <Input
              id="tienda-cliente"
              value={store}
              onChange={(e) => {
                setStore(e.target.value.slice(0, 80));
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "customer-login-error" : undefined}
              className="mt-2"
              autoComplete="off"
              placeholder="Ej.: Dulcería Norte, o el código de la tienda"
            />
          </>
        )}
        {error && (
          <p id="customer-login-error" role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <Button
        type="submit"
        variant="primary"
        disabled={busy}
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
    </form>
  );
}
