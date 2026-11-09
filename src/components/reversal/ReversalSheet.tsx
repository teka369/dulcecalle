"use client";

/**
 * C07 W2 — reason sheet with the dry-run preview («Qué pasa al anular»).
 * Owner + online only (callers hide/disable the entry point otherwise).
 * The preview is the server dry-run (J4): nothing is written and the key is
 * not consumed, so the real call reuses nothing from it.
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/data/errors";
import type { ReversalBody, ReversalResult } from "@/data/http/repository";
import {
  REVERSAL_REASONS,
  REASON_TEXT_MAX,
  blockerText,
  daysOld,
  previewLines,
  reasonBody,
  reasonError,
  reversalErrorText,
  warningText,
  type ReversalReasonCode,
} from "@/domain/reversal";

export type ReversalSheetProps = {
  title: string;
  kind: "sale" | "payment";
  ctaLabel: string;
  firstName: string | null;
  /** Original day (YYYY-MM-DD) for the > 30 days confirmation (G4b). */
  occurredOn: string;
  today: string;
  defaultReason?: ReversalReasonCode;
  /** Shown when «Devolución» is chosen on a sale (G4c). */
  returnHref?: string;
  /** Extra form (Corregir pago); `extraError` blocks the CTA. */
  extra?: React.ReactNode;
  extraError?: string | null;
  extraSignature?: string;
  preview: (body: ReversalBody) => Promise<ReversalResult>;
  submit: (body: ReversalBody, requestId: string) => Promise<ReversalResult>;
  onDone: (r: ReversalResult) => void;
  onClose: () => void;
};

export function ReversalSheet(props: ReversalSheetProps) {
  const titleId = useId();
  const counterId = useId();
  const [code, setCode] = useState<ReversalReasonCode | null>(props.defaultReason ?? null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReversalResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOld, setConfirmOld] = useState(false);
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const firstRadio = useRef<HTMLInputElement | null>(null);
  // Callers pass inline closures: run the dry-run once, on open.
  const previewRef = useRef(props.preview);

  useEffect(() => {
    firstRadio.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    // The effects do not depend on the reason: preview once with a valid one.
    previewRef.current({ reasonCode: "error_digitacion" })
      .then((r) => alive && setPreview(r))
      .catch((e: unknown) => {
        if (!alive) return;
        const c = e instanceof ApiError ? e.code : undefined;
        setPreviewError(reversalErrorText(c, props.kind));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blockers = (preview?.blockers ?? []).filter((b) => b !== "CONFIRM_OLD_REQUIRED");
  const old = daysOld(props.occurredOn, props.today) > 30;
  const reasonProblem = reasonError(code, text);
  const disabled = busy || !!reasonProblem || blockers.length > 0 || !!previewError || !!props.extraError;

  const send = (withOld: boolean) => {
    if (!code) return;
    const body: ReversalBody = { ...reasonBody(code, text), ...(withOld ? { confirmOld: true } : {}) };
    const sig = JSON.stringify([body, props.extraSignature ?? ""]);
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    props
      .submit(body, keyRef.current.key)
      .then((r) => {
        props.onClose();
        props.onDone(r);
      })
      .catch((e: unknown) => {
        const c = e instanceof ApiError ? e.code : e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : undefined;
        if (c === "CONFIRM_OLD_REQUIRED") {
          setConfirmOld(true);
          return;
        }
        setError(reversalErrorText(c, props.kind));
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={props.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-[var(--r-lg)] bg-bg p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onClose();
        }}
      >
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {props.title}
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Motivo</legend>
            <div role="radiogroup" aria-label="Motivo" className="flex flex-col">
              {REVERSAL_REASONS.map((r, i) => (
                <label key={r.code} className="flex min-h-11 items-center gap-3 text-sm text-ink">
                  <input
                    ref={i === 0 ? firstRadio : undefined}
                    type="radio"
                    name="reversal-reason"
                    value={r.code}
                    checked={code === r.code}
                    onChange={() => setCode(r.code)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
          {code === "otro" ? (
            <div className="flex flex-col gap-1">
              <textarea
                aria-label="Cuéntanos qué pasó"
                aria-describedby={counterId}
                placeholder="Cuéntanos qué pasó…"
                maxLength={REASON_TEXT_MAX}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-20 rounded-[var(--r-md)] border border-border bg-surface p-2 text-sm text-ink"
              />
              <p id={counterId} className="text-xs text-ink-muted">{`${text.trim().length}/${REASON_TEXT_MAX}`}</p>
            </div>
          ) : null}
          {code === "devolucion" && props.kind === "sale" && props.returnHref ? (
            <p className="rounded-[var(--r-lg)] bg-info-soft px-3 py-2.5 text-sm text-info">
              {"Si el cliente regresó productos, usa Devolver: queda mejor registrado. "}
              <Link href={props.returnHref} className="font-semibold underline underline-offset-2">
                Ir a Devolver›
              </Link>
            </p>
          ) : null}

          {props.extra}

          <section aria-live="polite" className="rounded-[var(--r-lg)] bg-surface-2 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {props.kind === "sale" ? "Qué pasa al anular" : "Qué pasa"}
            </p>
            {preview ? (
              <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink">
                {previewLines(
                  { effects: preview.effects, warnings: preview.warnings ?? [], blockers: preview.blockers ?? [], after: preview.after },
                  props.firstName,
                ).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : previewError ? (
              <p className="mt-1 text-sm text-danger">{previewError}</p>
            ) : (
              <p className="mt-1 text-sm text-ink-muted">Calculando…</p>
            )}
          </section>

          {blockers.map((b) => (
            <p key={b} role="alert" className="rounded-[var(--r-lg)] bg-warning-soft px-3 py-2.5 text-sm text-warning">
              {blockerText(b)}{" "}
              <Link href="/mas/caja" className="font-semibold underline underline-offset-2">
                Abrir caja›
              </Link>
            </p>
          ))}
          {(preview?.warnings ?? []).map((w) => (
            <p key={w} className="rounded-[var(--r-lg)] bg-warning-soft px-3 py-2.5 text-sm text-warning">
              {warningText(w, preview ?? undefined)}
            </p>
          ))}
          {code && reasonProblem && code === "otro" ? <p className="text-sm text-ink-muted">{reasonProblem}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          {confirmOld ? (
            <div role="alertdialog" aria-label="Confirmar anulación antigua" className="flex flex-col gap-2 rounded-[var(--r-lg)] border border-border p-3">
              <p className="text-sm font-semibold text-ink">
                {`Es del ${props.occurredOn} (${daysOld(props.occurredOn, props.today)} días). ¿Seguro que quieres anularla?`}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmOld(false)}>
                  Cancelar
                </Button>
                <Button variant="danger" className="flex-1" disabled={busy} onClick={() => send(true)}>
                  Sí, anular
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={props.onClose}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={disabled}
                onClick={() => (old ? setConfirmOld(true) : send(false))}
              >
                {props.ctaLabel}
              </Button>
            </div>
          )}
          <p className="text-xs text-ink-muted">Un reverso no se puede anular.</p>
        </div>
      </div>
    </div>
  );
}
