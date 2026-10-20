"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { getPwaAuthSession } from "@/data/http/session";
import { getOutboxStore } from "@/data/local/outbox";
import { discardOutboxOperation } from "@/data/pwa/sync-tray";
import { syncStore } from "@/store/syncStore";

const ID = /^[0-9a-zA-Z-]{1,64}$/;

/**
 * loop/v1 conflict UI: «Corregir» opens a form with `?rechazada=<operationId>`.
 * After the corrected form saves, `afterSave(go)` asks «¿Descartar la
 * operación rechazada?»: Descartar discards that outbox op (only if it is
 * still failed), Cancelar keeps it; both then `go()`. Without the param,
 * `go()` runs after `delayMs` as before.
 */
export function useRejectedCorrection(): { afterSave: (go: () => void, delayMs?: number) => void; dialog: ReactNode } {
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const goRef = useRef<() => void>(() => undefined);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("rechazada")?.trim();
    if (raw && ID.test(raw)) setRejectedId(raw);
  }, []);
  useEffect(() => {
    if (open) boxRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  function afterSave(go: () => void, delayMs = 700) {
    if (!rejectedId) {
      setTimeout(go, delayMs);
      return;
    }
    goRef.current = go;
    setOpen(true);
  }

  async function close(discard: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (discard && rejectedId) {
        const businessId = getPwaAuthSession().businessId;
        const op = businessId ? await getOutboxStore().get(businessId, rejectedId) : null;
        if (businessId && op && op.status === "failed") {
          await discardOutboxOperation(businessId, rejectedId);
          await syncStore.refresh();
        }
      }
    } catch {
      // Keep it: the user can still discard from the sync center.
    } finally {
      setBusy(false);
      setOpen(false);
      setRejectedId(null);
      goRef.current();
    }
  }

  const dialog = open ? (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rejected-discard-title"
        aria-describedby="rejected-discard-desc"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            void close(false);
          }
        }}
        className="w-full max-w-sm rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
      >
        <p id="rejected-discard-title" className="text-sm font-semibold">¿Descartar la operación rechazada?</p>
        <p id="rejected-discard-desc" className="mt-1 text-xs leading-relaxed text-ink-muted">
          Ya guardaste la versión corregida. Si la descartas, la rechazada no se vuelve a enviar. Si cancelas, queda en Sincronización.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void close(false)} className="w-full">
            Cancelar
          </Button>
          <Button type="button" variant="danger" disabled={busy} onClick={() => void close(true)} className="w-full">
            Descartar
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { afterSave, dialog };
}
