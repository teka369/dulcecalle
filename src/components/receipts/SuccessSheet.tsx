"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { NetworkError } from "@/data/errors";
import { getPwaApi } from "@/data/pwa/api";
import { linkShareText, whatsappHref, type ReceiptRef, type SuccessView } from "@/domain/receipts/success-sheet";

/**
 * C09-PR6 — «Listo · DC-…» bottom sheet after a sale or an abono
 * (WIRES-C09 W2, SPEC-C09 §5.1). Sharing is optional: closing never blocks.
 * One link per sheet, created only when the owner asks for it.
 */
export type SuccessSheetProps = {
  view: SuccessView;
  receipt: ReceiptRef | null;
  /** «$ 3.000 · Fiada · Marta» (UX-ventas §1 línea 2). */
  detail?: string;
  onClose: () => void;
  /** Sale only: start the next sale without going through Inicio. */
  onNewSale?: () => void;
};

const LINK_FAILED = "No pudimos crear el enlace. Intenta de nuevo.";
const LINK_OFFLINE = "Sin conexión. El enlace se crea con conexión.";
const COPY_FAILED = "No se pudo copiar. Mantén presionado el enlace para copiarlo.";

export function SuccessSheet({ view, receipt, detail, onClose, onNewSale }: SuccessSheetProps) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);
  const [canShare, setCanShare] = useState(false);
  // One Idempotency-Key per sheet (audit only: the server mints a link per call).
  const requestId = useRef<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    firstRef.current?.focus();
  }, []);

  async function ensureLink(): Promise<string | null> {
    if (link) return link;
    if (!receipt) return null;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new NetworkError();
      requestId.current ??= crypto.randomUUID();
      const r = await getPwaApi().receipts.createLink(receipt.id, requestId.current);
      setLink(r.url);
      return r.url;
    } catch (e) {
      setError(e instanceof NetworkError ? LINK_OFFLINE : LINK_FAILED);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(ok);
      setShowUrl(false);
    } catch {
      setError(COPY_FAILED);
      setShowUrl(true);
    }
  }

  async function copyLink() {
    const url = await ensureLink();
    if (url) await copy(url, "Enlace copiado");
  }

  async function shareWhatsApp() {
    // Open the tab inside the tap so it is not blocked; point it at wa.me once the link exists.
    const tab = link ? null : window.open("", "_blank");
    const url = await ensureLink();
    if (!url || !receipt) {
      tab?.close();
      return;
    }
    const href = whatsappHref(linkShareText(receipt.number, url));
    if (tab) {
      tab.opener = null;
      tab.location.href = href;
    } else {
      window.open(href, "_blank", "noopener");
    }
  }

  async function sendToCustomer() {
    const url = await ensureLink();
    if (!url || !receipt) return;
    const text = linkShareText(receipt.number, url);
    try {
      await navigator.share({ text });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      await copy(url, "Enlace copiado");
    }
  }

  async function shareText() {
    setError(null);
    setNotice(null);
    if (canShare) {
      try {
        await navigator.share({ text: view.plainText });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    await copy(view.plainText, "Texto copiado");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="success-sheet-title"
        data-testid="success-sheet"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full max-w-md rounded-t-[var(--r-lg)] border border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-sm)] sm:rounded-[var(--r-lg)]"
      >
        <p id="success-sheet-title" className="text-base font-semibold">
          {view.title}
        </p>
        {detail ? <p className="mt-1 text-sm text-ink">{detail}</p> : null}
        {view.reference ? <p className="mt-1 text-sm text-ink-muted">{view.reference}</p> : null}
        {view.linkNotice ? <p className="mt-1 text-xs leading-relaxed text-ink-muted">{view.linkNotice}</p> : null}
        {view.offlineNotice ? <p className="mt-1 text-xs leading-relaxed text-ink-muted">{view.offlineNotice}</p> : null}

        <div className="mt-3 grid gap-2">
          {view.canLink ? (
            <>
              <Button ref={firstRef} type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => void shareWhatsApp()}>
                Compartir por WhatsApp
              </Button>
              <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => void copyLink()}>
                Copiar enlace
              </Button>
              {canShare ? (
                <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => void sendToCustomer()}>
                  Enviar enlace al cliente
                </Button>
              ) : null}
            </>
          ) : (
            <Button ref={firstRef} type="button" variant="secondary" className="w-full" onClick={() => void shareText()}>
              Compartir texto
            </Button>
          )}
        </div>

        <div aria-live="polite" className="min-h-0">
          {busy ? <p className="mt-2 text-xs text-ink-muted">Creando enlace…</p> : null}
          {notice ? (
            <p role="status" className="mt-2 text-xs font-semibold text-ink">
              {notice}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-danger">
            {error}
          </p>
        ) : null}
        {showUrl && link ? <p className="mt-1 select-all break-all text-xs text-ink">{link}</p> : null}

        <div className={`mt-3 grid gap-2 ${onNewSale ? "grid-cols-2" : "grid-cols-1"}`}>
          {onNewSale ? (
            <Link
              href="/ventas/nueva"
              onClick={(e) => {
                e.preventDefault();
                onNewSale();
              }}
              className="inline-flex h-11 min-h-11 w-full items-center justify-center rounded-[var(--r-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary bg-cta px-4 text-sm font-semibold text-cta-fg hover:opacity-[0.92]"
            >
              Nueva venta
            </Link>
          ) : null}
          <Button type="button" variant={onNewSale ? "ghost" : "primary"} className="w-full" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
