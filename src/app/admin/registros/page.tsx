"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, NetworkError } from "@/data/errors";
import { apiBaseUrl } from "@/data/backend";
import { HttpRepository, type RegistrationDetail, type RegistrationRow } from "@/data/http/repository";
import { getPwaAuthSession } from "@/data/http/session";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const FILTERS = [
  { id: "PENDING_ADMIN_APPROVAL", label: "Por aprobar" },
  { id: "PENDING_EMAIL_VERIFICATION", label: "Sin confirmar" },
  { id: "APPROVED", label: "Aprobadas" },
  { id: "REJECTED", label: "Rechazadas" },
  { id: "", label: "Todas" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  PENDING_EMAIL_VERIFICATION: "Falta confirmar el correo",
  PENDING_ADMIN_APPROVAL: "Pendiente de aprobación",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
};

export default function AdminRegistrationsPage() {
  const [status, setStatus] = useState<string>("PENDING_ADMIN_APPROVAL");
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const repo = useCallback(() => {
    const base = apiBaseUrl();
    if (!base) throw new Error("El servidor no está configurado.");
    return new HttpRepository(base, getPwaAuthSession());
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setRows(await repo().registrations.list(status || undefined));
    } catch (err) {
      setRows([]);
      if (err instanceof ApiError && (err.status === 403 || err.code === "FORBIDDEN")) {
        setError("No tienes permiso para ver las solicitudes.");
      } else if (err instanceof ApiError && err.status === 401) {
        setError("Inicia sesión para ver las solicitudes.");
      } else if (err instanceof NetworkError || !(err instanceof ApiError)) {
        setError("Sin conexión. No pudimos cargar las solicitudes.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [repo, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(id: string) {
    setError(null);
    try {
      setDetail(await repo().registrations.get(id));
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos abrir la solicitud.");
    }
  }

  async function decide(kind: "approve" | "reject") {
    if (!detail || busy) return;
    const question =
      kind === "approve"
        ? `¿Aprobar la cuenta de ${detail.name}?`
        : `¿Rechazar la solicitud de ${detail.name}?`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "approve") await repo().registrations.approve(detail.id);
      else await repo().registrations.reject(detail.id, note.trim() || undefined);
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la decisión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock size="medium" title="Solicitudes" subtitle="Solo se aprueban con tu sesión. El correo no alcanza." />
      <Sheet>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <Button
              key={filter.label}
              type="button"
              variant={status === filter.id ? "primary" : "secondary"}
              onClick={() => setStatus(filter.id)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {loading ? <p className="text-sm text-ink-muted">Cargando solicitudes…</p> : null}
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card>
                <button type="button" className="w-full text-left" onClick={() => void open(row.id)}>
                  <p className="text-base font-semibold">{row.name}</p>
                  <p className="mt-1 text-sm text-ink-muted">{row.email}</p>
                  <p className="mt-1 text-sm">{STATUS_LABEL[row.status] ?? row.status}</p>
                </button>
              </Card>
            </li>
          ))}
        </ul>
        {rows.length === 0 && !error && !loading ? (
          <p className="text-sm text-ink-muted">No hay solicitudes en esta lista.</p>
        ) : null}
        {detail ? (
          <Card>
            <p className="text-base font-semibold">{detail.name}</p>
            <p className="mt-1 text-sm text-ink-muted">{detail.email}</p>
            <p className="mt-2 text-sm">{STATUS_LABEL[detail.status] ?? detail.status}</p>
            <p className="mt-1 text-sm text-ink-muted">
              Correo confirmado: {detail.emailVerifiedAt ? "sí" : "no"}
            </p>
            {detail.decidedByEmail ? (
              <p className="mt-1 text-sm text-ink-muted">Decidió {detail.decidedByEmail}</p>
            ) : null}
            <ul className="mt-3 flex flex-col gap-1">
              {detail.history.map((item) => (
                <li key={item.id} className="text-sm text-ink-muted">
                  {item.action}
                  {item.actorEmail ? ` · ${item.actorEmail}` : ""}
                  {item.note ? ` · ${item.note}` : ""}
                </li>
              ))}
            </ul>
            {detail.status === "PENDING_ADMIN_APPROVAL" ? (
              <div className="mt-4 flex flex-col gap-3">
                <label className="text-sm font-medium" htmlFor="reject-note">
                  Nota si la rechazas (opcional)
                </label>
                <textarea
                  id="reject-note"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-24 w-full rounded-[var(--r-md)] border border-border bg-surface px-3 py-2 text-base text-ink"
                />
                <Button type="button" variant="primary" disabled={busy} onClick={() => void decide("approve")}>
                  {busy ? "Guardando…" : "Aprobar"}
                </Button>
                <Button type="button" variant="danger" disabled={busy} onClick={() => void decide("reject")}>
                  Rechazar
                </Button>
              </div>
            ) : null}
          </Card>
        ) : null}
      </Sheet>
    </div>
  );
}
