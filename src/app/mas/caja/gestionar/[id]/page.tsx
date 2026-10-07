"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { formatCop } from "@/domain/money";
import { getPwaApi } from "@/data/pwa/api";
import { carryCashWithOfflineFallback } from "@/data/pwa/offline-operations";

type Detail = {
  id: string;
  localDate: string;
  openingFloat: number;
  expectedEfectivo: number;
  expectedNequi: number;
  moveCount: number;
  laterActivity: boolean;
  canCountClose: boolean;
  requiresCarry: boolean;
  hasLaterOpenSession: boolean;
  regularized: boolean;
  closeMode: string | null;
  note: string | null;
  moves: Array<{ id: string; kind: string; method: string; amount: number; direction: string; occurredOn: string }>;
  stampedMoves: Array<{ id: string; kind: string; method: string; amount: number; direction: string; occurredOn: string }>;
};

export default function GestionarCajaDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [counted, setCounted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPwaApi().cash.session(params.id).then((row) => setDetail(row as Detail));
  }, [params.id]);

  async function closeCounted() {
    setBusy(true);
    setError(null);
    try {
      await getPwaApi().cash.close(params.id, Number(counted));
      router.push("/mas/caja/gestionar");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar.");
    } finally {
      setBusy(false);
    }
  }

  async function carry(mode: "counted" | "assumed") {
    setBusy(true);
    setError(null);
    try {
      await carryCashWithOfflineFallback(params.id, {
        mode,
        countedEfectivo: mode === "counted" ? Number(counted) : undefined,
      });
      router.push("/mas/caja");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo pasar el saldo.");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link href="/mas/caja/gestionar" className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg" aria-label="Volver">←</Link>
        <h1 className="text-[22px] font-semibold">Caja del {detail.localDate}</h1>
      </header>
      <Card className="flex flex-col gap-1">
        <p>Efectivo inicial: {formatCop(detail.openingFloat)}</p>
        <p>Efectivo esperado: {formatCop(detail.expectedEfectivo)}</p>
        <p>Nequi esperado: {formatCop(detail.expectedNequi)}</p>
        <p>{detail.moveCount} movimientos</p>
        {detail.hasLaterOpenSession && <p>Esta caja tiene una caja posterior abierta. Su efectivo inicial no se va a sumar.</p>}
        {detail.closeMode === "assumed" && <p>{detail.note}</p>}
      </Card>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Movimientos de esta caja</h2>
        {detail.moves.map((move) => (
          <p key={move.id} className="text-sm">{move.occurredOn} · {move.kind} · {move.method} · {move.direction === "in" ? "+" : "−"}{formatCop(move.amount)}</p>
        ))}
      </section>
      {detail.stampedMoves.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Esto pasa al continuar el saldo</h2>
          {detail.stampedMoves.map((move) => (
            <p key={move.id} className="text-sm">{move.occurredOn} · {move.kind} · {move.method} · {move.direction === "in" ? "+" : "−"}{formatCop(move.amount)}</p>
          ))}
        </section>
      )}
      {!detail.regularized && (
        <Card className="flex flex-col gap-3">
          {detail.canCountClose && (
            <>
              <label className="text-sm font-medium">¿Cuánto efectivo había en esta caja?</label>
              <Input inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ""))} />
              <Button type="button" disabled={busy} onClick={() => void closeCounted()}>Cerrar contando</Button>
            </>
          )}
          <p className="text-sm text-ink-muted">Cerrar por paso de saldo no es un conteo físico. Se usa el efectivo esperado como continuidad. El faltante se ve cuando cuentes una caja posterior.</p>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void carry(detail.requiresCarry ? "assumed" : "counted")}>
            {detail.requiresCarry ? "Cerrar por paso de saldo" : "Continuar saldo"}
          </Button>
        </Card>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
