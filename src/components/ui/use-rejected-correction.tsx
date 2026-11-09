"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { getPwaAuthSession } from "@/data/http/session";
import { getOutboxStore } from "@/data/local/outbox";
import { DISCARD_ATTEMPTED_WARNING } from "@/data/pwa/sync-copy";
import { discardOutboxOperation } from "@/data/pwa/sync-tray";
import { syncStore } from "@/store/syncStore";

const ID = /^[0-9a-zA-Z-]{1,64}$/;

async function readAttempts(operationId: string): Promise<number> {
  try {
    const businessId = getPwaAuthSession().businessId;
    const op = businessId ? await getOutboxStore().get(businessId, operationId) : undefined;
    return op?.attempts ?? 0;
  } catch {
    return 0;
  }
}

/**
 * loop/v1 conflict UI: «Corregir» opens a form with `?rechazada=<operationId>`.
 * After the corrected form saves, `afterSave(go)` asks «¿Descartar la
 * operación rechazada?»: Descartar discards that outbox op (only if it is
 * still failed), Cancelar keeps it; both then `go()`. Without the param,
 * `go()` runs after `delayMs` as before.
 */
export function useRejectedCorrection(): { afterSave: (go: () => void, delayMs?: number, replacedBy?: string | null) => void; dialog: ReactNode; pending: boolean } {
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const goRef = useRef<() => void>(() => undefined);
  const replacedByRef = useRef<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("rechazada")?.trim();
    if (raw && ID.test(raw)) setRejectedId(raw);
  }, []);
  useEffect(() => {
    if (open) boxRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  /** `replacedBy` = requestId of the corrected op (C01 «Reemplazada por» link). */
  function afterSave(go: () => void, delayMs = 700, replacedBy: string | null = null) {
    replacedByRef.current = replacedBy;
    if (!rejectedId) {
      setTimeout(go, delayMs);
      return;
    }
    goRef.current = go;
    // C01.4 / C013-INV-01 — read attempts before opening so the INV-03 warning
    // does not flash in or appear late.
    void (async () => {
      setAttempts(await readAttempts(rejectedId));
      setOpen(true);
    })();
  }

  async function close(discard: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (discard && rejectedId) {
        const businessId = getPwaAuthSession().businessId;
        const op = businessId ? await getOutboxStore().get(businessId, rejectedId) : null;
        if (businessId && op && op.status === "failed") {
          await discardOutboxOperation(businessId, rejectedId, { replacedBy: replacedByRef.current });
          await syncStore.refresh();
          void syncStore.syncNow().catch(() => undefined);
        }
      }
    } catch {
      // Keep it: the user can still discard from the sync center.
    } finally {
      setBusy(false);
      setOpen(false);
      setRejectedId(null);
      setAttempts(0);
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
        {attempts > 0 ? (
          <p className="mt-1 text-xs font-semibold text-danger" data-testid="discard-attempted-warning">
            {DISCARD_ATTEMPTED_WARNING}
          </p>
        ) : null}
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

  // C01.3 — pending covers both the open dialog and the ?rechazada= flow, so
  // cobrar's empty-cart redirect cannot unmount the dialog after clear().
  return { afterSave, dialog, pending: open || Boolean(rejectedId) };
}
