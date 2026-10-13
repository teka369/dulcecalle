"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { AmountField } from "@/components/ui/AmountField";
import { ChoiceSegmented } from "@/components/ui/ChoiceSegmented";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { ActionBar } from "@/components/ui/ActionBar";
import { kindLabel, moveSign } from "@/components/cash/cash";
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
  const [mode, setMode] = useState<"contar" | "saldo" | null>(null);

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

  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonHero />
        <SkeletonRows />
      </div>
    );
  }

  const choice = mode ?? (detail.canCountClose ? "contar" : "saldo");
  const saldoLabel = detail.requiresCarry ? "Cerrar por paso de saldo" : "Continuar saldo";
  const moveRows = (list: Detail["moves"]) =>
    list.map((move) => {
      const sg = moveSign(move);
      return (
        <Row
          key={move.id}
          title={`${kindLabel(move.kind)} · ${move.method}`}
          meta={move.occurredOn}
          trailing={
            <>
              <span className={`text-[15px] font-semibold tabular-nums ${sg.tone === "ok" ? "text-ok" : "text-danger"}`}>
                {sg.sign} {formatCop(move.amount)}
              </span>
              <span className="text-xs text-ink-muted">{sg.word}</span>
            </>
          }
        />
      );
    });

  return (
    <div className="flex flex-col pb-[calc(var(--actionbar-h)+4.75rem+1.5rem)]">
      <HeroBlock
        size="medium"
        back={{ href: "/mas/caja/gestionar", label: "Volver a Gestionar cajas" }}
        title={`Caja del ${detail.localDate}`}
        subtitle={`Efectivo inicial ${formatCop(detail.openingFloat)} · ${detail.moveCount} movimientos`}
      >
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-on-hero-muted">Esperado efectivo</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">{formatCop(detail.expectedEfectivo)}</p>
        <p className="mt-1 text-sm text-on-hero-muted">Nequi {formatCop(detail.expectedNequi)}</p>
      </HeroBlock>
      <Sheet>
        {detail.hasLaterOpenSession ? (
          <StateBlock
            kind="offline-miss"
            title="Esta caja tiene una caja posterior abierta."
            body="Su efectivo inicial no se va a sumar."
          />
        ) : null}
        {detail.closeMode === "assumed" && detail.note ? <RowGroupNote>{detail.note}</RowGroupNote> : null}

        {!detail.regularized ? (
          <section className="flex flex-col gap-3">
            <ChoiceSegmented<"contar" | "saldo">
              label="Cómo cerrar"
              options={[
                { id: "contar", label: "Cerrar contando" },
                { id: "saldo", label: "Continuar saldo" },
              ]}
              value={choice}
              onChange={(id) => {
                if (id === "contar" && !detail.canCountClose) return;
                setMode(id);
              }}
            />
            {!detail.canCountClose ? (
              <p className="text-sm text-ink-muted">Cerrar contando no está disponible: hay que pasar el saldo.</p>
            ) : null}
            {choice === "contar" ? (
              <AmountField label="¿Cuánto efectivo había en esta caja?" value={counted} onChange={setCounted} />
            ) : (
              <p className="text-sm text-ink-muted">
                Cerrar por paso de saldo no es un conteo físico. Se usa el efectivo esperado como continuidad. El faltante se
                ve cuando cuentes una caja posterior.
              </p>
            )}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <SectionHead title="Movimientos de esta caja" />
          {detail.moves.length === 0 ? (
            <RowGroupNote>Aún no hay movimientos.</RowGroupNote>
          ) : (
            <RowGroup label="Movimientos de esta caja">{moveRows(detail.moves)}</RowGroup>
          )}
        </section>
        {detail.stampedMoves.length > 0 ? (
          <section className="flex flex-col gap-2">
            <SectionHead title="Esto pasa al continuar el saldo" />
            <RowGroup label="Esto pasa al continuar el saldo">{moveRows(detail.stampedMoves)}</RowGroup>
          </section>
        ) : null}
        {error ? <StateBlock kind="error" title={error} /> : null}
      </Sheet>
      {!detail.regularized ? (
        <ActionBar
          aboveNav
          primary={
            choice === "contar"
              ? { label: "Cerrar contando", onClick: () => void closeCounted(), disabled: counted === "", busy }
              : {
                  label: saldoLabel,
                  onClick: () => void carry(detail.requiresCarry ? "assumed" : "counted"),
                  busy,
                }
          }
        />
      ) : null}
    </div>
  );
}
