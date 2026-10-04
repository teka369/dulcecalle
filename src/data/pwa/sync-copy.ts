import type { SyncCounts } from "@/store/syncStore";

/** Shown wherever discard is offered. Does not describe a data delete. */
export const DISCARD_NOTICE =
  "No enviar elimina este envío pendiente de este dispositivo. No deshace nada que ya esté guardado en el servidor. El registro puede seguir apareciendo en este teléfono hasta que los datos locales se actualicen o se eliminen mediante el flujo correspondiente.";

export const NOT_A_BACKUP = "Esto no es una copia de seguridad.";

export function syncPillLabel(
  online: boolean,
  counts: SyncCounts,
  flushing: { completed: number; total: number } | null,
  authRequired = false,
): string {
  if (!online) {
    return counts.total > 0
      ? `○ Sin conexión · ${savedHere(counts.total)}`
      : "○ Sin conexión";
  }
  if (authRequired) {
    return "Entra para enviar lo guardado aquí";
  }
  if (flushing && flushing.total > 0) {
    const done = Math.min(flushing.completed, flushing.total);
    return `↑ Enviando ${done} de ${flushing.total}`;
  }
  if (counts.permanent > 0) {
    return `! ${counts.permanent} necesita${counts.permanent === 1 ? "" : "n"} atención`;
  }
  if (counts.total > 0) {
    return savedHere(counts.total);
  }
  return "✓ En el servidor";
}

function savedHere(total: number): string {
  return total === 1 ? "1 guardada aquí" : `${total} guardadas aquí`;
}

export function formatDateTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "hoy 14:02" on the same local day; otherwise the app's usual date. */
export function formatSyncWhen(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  if (!sameDay) return formatDateTime(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `hoy ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Time of the last cycle that finished with nothing left to send.
 * When the queue is not clear, the wording must not imply this cycle delivered it.
 * Never invents a clock.
 */
export function lastCompletedSyncLine(
  at: number | null,
  queueClear: boolean,
  now: number = Date.now(),
): string {
  if (at == null) return "Aún no hay un envío registrado";
  const when = formatSyncWhen(at, now);
  return queueClear ? `Último envío: ${when}` : `Último envío completo: ${when}`;
}

export function queueIsClear(input: {
  counts: SyncCounts;
  flushing: { completed: number; total: number } | null;
  authRequired: boolean;
}): boolean {
  return !input.authRequired && !input.flushing && input.counts.total === 0;
}

export type SyncPlaceCopy = {
  lead: string;
  server: string;
  device: string;
  attention: string;
};

export function syncPlaceCopy(input: {
  online: boolean;
  authRequired: boolean;
  flushing: { completed: number; total: number } | null;
  counts: SyncCounts;
}): SyncPlaceCopy {
  const { online, authRequired, flushing, counts } = input;
  const saved = Math.max(0, counts.total - counts.permanent);
  const sending = Boolean(flushing && flushing.total > 0);

  let lead: string;
  if (!online) {
    lead =
      counts.total > 0
        ? "Sin conexión. Lo guardado aquí no se ha perdido. Se enviará cuando vuelva la conexión y todavía no está en el servidor."
        : "Sin conexión. No hay nada pendiente de enviar en este teléfono.";
  } else if (authRequired) {
    lead = "Entra para enviar lo guardado aquí. Nada se perdió en este teléfono.";
  } else if (sending) {
    lead = `Enviando ${Math.min(flushing!.completed, flushing!.total)} de ${flushing!.total}.`;
  } else if (counts.permanent > 0) {
    lead = "Hay algo en este teléfono que no se enviará solo.";
  } else if (counts.total > 0) {
    lead = "Hay operaciones guardadas solo en este teléfono.";
  } else {
    lead = "No hay operaciones pendientes de enviar desde este teléfono.";
  }

  const server = sending
    ? "El envío está en curso. Lo que aún no termine sigue solo en este teléfono."
    : counts.total === 0 && !authRequired
      ? "No hay operaciones pendientes de enviar desde este dispositivo."
      : "Lo que sigue pendiente todavía no está confirmado por el servidor.";

  const device =
    saved === 0
      ? "No hay operaciones esperando envío."
      : saved === 1
        ? "1 operación guardada en este teléfono, sin confirmar por el servidor."
        : `${saved} operaciones guardadas en este teléfono, sin confirmar por el servidor.`;

  const attention =
    counts.permanent === 0
      ? "No hay nada que revisar."
      : counts.permanent === 1
        ? "1 operación necesita atención y no se enviará sola."
        : `${counts.permanent} operaciones necesitan atención y no se enviarán solas.`;

  return { lead, server, device, attention };
}

export function syncOperationNotes(item: {
  status: "pending" | "in_flight" | "failed";
  localCreatedAt: number;
  attempts: number;
  nextAttemptAt: number | null;
}): string[] {
  const status =
    item.status === "failed"
      ? "No enviado"
      : item.status === "in_flight"
        ? "Enviando"
        : "Guardada aquí";
  const lines = [
    `Estado: ${status}`,
    `Creada: ${formatDateTime(item.localCreatedAt)}`,
    `Intentos: ${item.attempts}`,
  ];
  if (item.status === "failed" && item.nextAttemptAt != null) {
    lines.push("Se reintentará automáticamente.");
  }
  if (item.status === "failed" && item.nextAttemptAt == null) {
    lines.push("No se enviará sola. Revisa el motivo y reintenta si corresponde.");
  }
  return lines;
}
