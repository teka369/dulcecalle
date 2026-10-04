"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  STORAGE_BACKUP_NOTE,
  STORAGE_NOT_A_BACKUP_BUTTON,
  STORAGE_PERSISTENT_LIMIT,
  readOriginStorage,
  requestOriginPersistence,
  storageMissingUsageLine,
  storagePercentLine,
  storageProtectionCopy,
  storageQuotaLine,
  storageRequestMessage,
  storageUsageLine,
  storageWarningLine,
  type OriginStorageAction,
  type OriginStorageSnapshot,
} from "@/data/pwa/origin-storage";

export function StorageProtectionCard() {
  const [snapshot, setSnapshot] = useState<OriginStorageSnapshot | null>(null);
  const [action, setAction] = useState<OriginStorageAction | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void readOriginStorage().then((next) => {
      if (live) setSnapshot(next);
    });
    return () => {
      live = false;
    };
  }, []);

  async function onProtect() {
    setBusy(true);
    try {
      const next = await requestOriginPersistence();
      setSnapshot(next);
      setAction(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--r-lg)] border border-border bg-bg p-3 text-sm">
      <h2 className="font-semibold">Protección del dispositivo</h2>
      <ul className="mt-2 flex flex-col gap-2 text-ink-muted">
        <li>
          <span className="font-semibold text-ink">En el servidor.</span> Lo que ya fue aceptado
          por el servidor. El resumen de arriba dice si queda algo por enviar.
        </li>
        <li>
          <span className="font-semibold text-ink">Guardado solo aquí.</span> Operaciones de este
          teléfono que el servidor todavía no ha confirmado.
        </li>
        <li>
          <span className="font-semibold text-ink">Protección del dispositivo.</span> Si el
          navegador prometió no borrar este sitio solo porque falta espacio.
        </li>
        <li>
          <span className="font-semibold text-ink">Copia de seguridad.</span> {STORAGE_BACKUP_NOTE}
        </li>
      </ul>

      {snapshot == null ? (
        <p className="mt-3 text-ink-muted">Consultando el almacenamiento de este sitio.</p>
      ) : (
        <StorageStatus snapshot={snapshot} action={action} busy={busy} onProtect={() => void onProtect()} />
      )}
    </section>
  );
}

function StorageStatus({
  snapshot,
  action,
  busy,
  onProtect,
}: {
  snapshot: OriginStorageSnapshot;
  action: OriginStorageAction | null;
  busy: boolean;
  onProtect: () => void;
}) {
  const copy = storageProtectionCopy(snapshot);
  const usage = storageUsageLine(snapshot);
  const quota = storageQuotaLine(snapshot);
  const percent = storagePercentLine(snapshot);
  const warning = storageWarningLine(snapshot);
  const missing = storageMissingUsageLine(snapshot);
  const requestMessage = action ? storageRequestMessage(action) : null;
  const canAsk = snapshot.supported && snapshot.error !== "unsupported" && snapshot.persistent !== true;

  return (
    <div className="mt-3">
      <p className="font-semibold">{copy.title}</p>
      <p className="mt-1 leading-snug text-ink-muted">{copy.body}</p>
      {usage && <p className="mt-3">{usage}</p>}
      {quota && <p className="mt-1 text-ink-muted">{quota}</p>}
      {percent && <p className="mt-1 text-ink-muted">{percent}</p>}
      {missing && <p className="mt-3 text-ink-muted">{missing}</p>}
      {warning && <p className="mt-3 font-semibold text-danger">{warning}</p>}
      {snapshot.persistent === true && (
        <p className="mt-3 leading-snug text-ink-muted">{STORAGE_PERSISTENT_LIMIT}</p>
      )}
      {canAsk && (
        <>
          <p className="mt-3 leading-snug text-ink-muted">{STORAGE_NOT_A_BACKUP_BUTTON}</p>
          <Button type="button" variant="primary" className="mt-3 w-full" disabled={busy} onClick={onProtect}>
            {busy ? "Solicitando protección…" : "Proteger almacenamiento de este dispositivo"}
          </Button>
        </>
      )}
      {requestMessage && (
        <p className="mt-3 leading-snug" role="status">
          {requestMessage}
        </p>
      )}
    </div>
  );
}
