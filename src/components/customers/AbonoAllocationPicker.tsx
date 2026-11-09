"use client";

/**
 * C04 W1 — «Aplicar a» (FIFO / Una compra / Repartir) and «Así queda».
 * Online the table is a preview the server confirms; offline it is labeled
 * «Así quedará (estimado)» (T20) and the excess shows as saldo a favor (T21).
 */
import { formatCop } from "@/domain/money";
import { AmountField } from "@/components/ui/AmountField";
import { PendingBadge } from "@/components/ui/StatusBadge";
import type { OpenObligation } from "@/data/pwa/customer-allocations";
import { obligationKey, type AbonoChoice, type AbonoPreview } from "./abono-target";
import type { Overflow } from "@/domain/allocation";

const fmtN = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);

function Radio(props: { name: string; checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onChange} className="h-5 w-5" />
      <span>
        {props.label}
        {props.hint ? <span className="block text-xs text-ink-muted">{props.hint}</span> : null}
      </span>
    </label>
  );
}

export function AbonoAllocationPicker(props: {
  customerName: string;
  debt: number;
  obligations: OpenObligation[];
  estimated: boolean;
  choice: AbonoChoice;
  onChoice: (c: AbonoChoice) => void;
  overflow: Overflow;
  onOverflow: (o: Overflow) => void;
  preview: AbonoPreview;
  amount: number | null;
}) {
  const { choice, preview } = props;
  const open = props.obligations.filter((o) => o.open > 0);
  const openSales = open.filter((o) => o.kind === "sale");
  const splittable = open.filter((o) => !o.localRequestId);
  const first = props.customerName.split(" ")[0] ?? props.customerName;
  const showOverflow =
    props.amount != null &&
    ((choice.mode === "sale" &&
      choice.obligationId != null &&
      props.amount > (open.find((o) => o.kind === "sale" && o.id === choice.obligationId)?.open ?? 0)) ||
      (choice.mode === "split" && props.amount > preview.splitAssigned));

  return (
    <div className="flex flex-col gap-3">
      {props.debt <= 0 ? (
        <p className="text-sm text-ink">{`${first} no debe nada. Todo el abono queda como saldo a favor.`}</p>
      ) : (
        <fieldset className="flex flex-col">
          <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Aplicar a</legend>
          <Radio
            name="aplicar"
            checked={choice.mode === "fifo"}
            onChange={() => props.onChoice({ mode: "fifo" })}
            label="Más antiguas primero (recomendado)"
          />
          {openSales.length > 0 ? (
            <Radio
              name="aplicar"
              checked={choice.mode === "sale"}
              onChange={() => props.onChoice({ mode: "sale", obligationId: openSales.length === 1 ? openSales[0].id : null })}
              label="Una compra"
            />
          ) : null}
          {choice.mode === "sale" ? (
            <div className="ml-8 flex flex-col">
              {openSales.map((o) => (
                <Radio
                  key={o.id}
                  name="compra"
                  checked={choice.obligationId === o.id}
                  onChange={() => props.onChoice({ mode: "sale", obligationId: o.id })}
                  label={`${o.label} · Pendiente ${formatCop(o.open)}`}
                  hint={o.localRequestId ? "Aún sin enviar: el abono espera a que se envíe." : undefined}
                />
              ))}
            </div>
          ) : null}
          {splittable.length > 1 ? (
            <Radio
              name="aplicar"
              checked={choice.mode === "split"}
              onChange={() => props.onChoice({ mode: "split", amounts: {} })}
              label="Repartir"
            />
          ) : null}
          {choice.mode === "split" ? (
            <div className="ml-8 flex flex-col gap-3">
              {splittable.map((o) => {
                const key = obligationKey(o);
                return (
                  <AmountField
                    key={key}
                    label={`${o.label} · Pendiente ${formatCop(o.open)}`}
                    value={choice.amounts[key] ?? ""}
                    onChange={(v) => props.onChoice({ mode: "split", amounts: { ...choice.amounts, [key]: v } })}
                    error={preview.fieldErrors[key] ?? null}
                  />
                );
              })}
              {props.amount != null ? (
                <p className="text-xs text-ink-muted" aria-live="polite">
                  {`Repartido ${formatCop(preview.splitAssigned)} de ${formatCop(props.amount)} · Sin repartir ${formatCop(
                    Math.max(0, props.amount - preview.splitAssigned),
                  )} (va a más antiguas)`}
                </p>
              ) : null}
            </div>
          ) : null}
          {showOverflow ? (
            <fieldset className="ml-8 mt-1 flex flex-col">
              <legend className="text-xs text-ink-muted">El resto:</legend>
              <Radio name="resto" checked={props.overflow === "fifo"} onChange={() => props.onOverflow("fifo")} label="A las demás compras" />
              <Radio name="resto" checked={props.overflow === "credit"} onChange={() => props.onOverflow("credit")} label="Saldo a favor" />
            </fieldset>
          ) : null}
        </fieldset>
      )}

      {preview.error ? (
        <p role="alert" className="text-sm text-danger">
          {preview.error}
        </p>
      ) : null}

      {props.amount != null && props.amount > 0 ? (
        <section aria-live="polite" className="rounded-[var(--r-md)] bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">{props.estimated ? "Así quedará (estimado)" : "Así queda"}</h2>
            {props.estimated ? <PendingBadge /> : null}
          </div>
          {preview.rows.length > 0 ? (
            <table className="mt-2 w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th scope="col" className="font-normal">Compra</th>
                  <th scope="col" className="text-right font-normal">Antes</th>
                  <th scope="col" className="text-right font-normal">Después</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.key} className={r.changed ? "text-ink" : "text-ink-muted"}>
                    <td>{r.label}</td>
                    <td className="text-right">{fmtN(r.before)}</td>
                    <td className="text-right">{fmtN(r.after)}</td>
                  </tr>
                ))}
                {preview.toCredit > 0 ? (
                  <tr className="text-ink">
                    <td>Saldo a favor</td>
                    <td />
                    <td className="text-right">{`+${fmtN(preview.toCredit)}`}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : null}
          {preview.toCredit > 0 ? (
            <p className="mt-2 text-sm text-ink">{`Sobran ${formatCop(preview.toCredit)}: quedan como saldo a favor de ${first}.`}</p>
          ) : null}
          <p className="mt-2 text-sm font-semibold text-ink">{`Deuda ${formatCop(preview.debtBefore)} → ${formatCop(preview.debtAfter)}`}</p>
          {props.estimated ? <p className="mt-1 text-xs text-ink-muted">Puede cambiar al enviarse.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
