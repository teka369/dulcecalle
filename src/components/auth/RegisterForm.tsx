"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ApiError } from "@/data/errors";
import { HttpRepository } from "@/data/http/repository";
import { getPwaAuthSession } from "@/data/http/session";
import { apiBaseUrl } from "@/data/backend";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    if (!SITE_KEY) return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (lock.current || busy) return;
    setError(null);
    if (name.trim().length < 2) {
      setError("Escribe tu nombre.");
      return;
    }
    if (!email.includes("@")) {
      setError("Escribe un correo válido.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    const base = apiBaseUrl();
    if (!base) {
      setError("El servidor no está configurado.");
      return;
    }
    const turnstileToken = SITE_KEY
      ? (document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')?.value ?? "")
      : undefined;
    if (SITE_KEY && !turnstileToken) {
      setError("Confirma que no eres un robot.");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const repo = new HttpRepository(base, getPwaAuthSession());
      const result = await repo.auth.register({
        name: name.trim(),
        email: email.trim(),
        password,
        confirmPassword,
        companyWebsite,
        turnstileToken,
      });
      setDone(result.message);
    } catch (err) {
      lock.current = false;
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "No pudimos enviar la solicitud.");
    }
  }

  async function resend() {
    if (resendBusy) return;
    setResendNote(null);
    const base = apiBaseUrl();
    if (!base) {
      setResendNote("El servidor no está configurado.");
      return;
    }
    setResendBusy(true);
    try {
      const repo = new HttpRepository(base, getPwaAuthSession());
      await repo.auth.resendRegistration(email.trim());
      setResendNote("Si todavía falta confirmar el correo, te enviamos otro enlace.");
    } catch (err) {
      setResendNote(err instanceof ApiError ? err.message : "No pudimos reenviar el enlace.");
    } finally {
      setResendBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <p className="text-base font-semibold">Revisa tu correo</p>
        <p className="mt-2 text-sm text-ink-muted">{done}</p>
        <p className="mt-3 text-sm text-ink-muted">
          Confirmar el correo no abre la tienda. Después alguien de Dulce Calle aprueba la cuenta.
        </p>
        <button
          type="button"
          className="mt-4 min-h-11 text-left text-sm font-semibold text-ink"
          disabled={resendBusy}
          onClick={() => void resend()}
        >
          {resendBusy ? "Reenviando…" : "Reenviar enlace"}
        </button>
        {resendNote ? (
          <p role="status" className="mt-2 text-sm text-ink-muted">
            {resendNote}
          </p>
        ) : null}
        <Link href="/login" className="mt-4 flex min-h-11 items-center text-sm font-semibold text-ink">
          Volver a entrar
        </Link>
      </Card>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
      <Card>
        <label className="text-sm font-medium" htmlFor="reg-name">
          Nombre
        </label>
        <Input
          id="reg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="mt-2"
          autoFocus
        />
        <label className="mt-4 block text-sm font-medium" htmlFor="reg-email">
          Correo
        </label>
        <Input
          id="reg-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="mt-2"
        />
        <div className="mt-4 flex items-center justify-between">
          <label className="text-sm font-medium" htmlFor="reg-password">
            Contraseña
          </label>
          <button
            type="button"
            className="min-h-11 px-2 text-sm font-semibold text-ink"
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? "Ocultar" : "Mostrar"}
          </button>
        </div>
        <Input
          id="reg-password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          aria-describedby="reg-password-hint"
        />
        <p id="reg-password-hint" className="mt-2 text-sm text-ink-muted">
          Mínimo 8 caracteres. No la guardamos en claro.
        </p>
        <label className="mt-4 block text-sm font-medium" htmlFor="reg-confirm">
          Confirmar contraseña
        </label>
        <Input
          id="reg-confirm"
          type={showPassword ? "text" : "password"}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          className="mt-2"
        />
        <div className="sr-only" aria-hidden="true">
          <label htmlFor="companyWebsite">Sitio web</label>
          <input
            id="companyWebsite"
            name="companyWebsite"
            tabIndex={-1}
            autoComplete="off"
            value={companyWebsite}
            onChange={(e) => setCompanyWebsite(e.target.value)}
          />
        </div>
        {SITE_KEY ? <div className="cf-turnstile mt-4" data-sitekey={SITE_KEY} /> : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </Card>
      <Button type="submit" variant="primary" disabled={busy} className="min-h-12 w-full">
        {busy ? "Enviando…" : "Crear cuenta"}
      </Button>
    </form>
  );
}
