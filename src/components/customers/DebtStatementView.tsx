import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { SectionHead } from "@/components/ui/SectionHead";
import { formatCop } from "@/domain/money";
import { formatBogotaDateTime, type DebtEntry, type DebtStatement } from "@/domain/debt/statement";
import { statementRow } from "./clientes";

function entryMeta(entry: DebtEntry): string {
  const when = formatBogotaDateTime(entry.createdAt);
  if (entry.kind === "fiada" || entry.kind === "parcial") {
    const items = entry.lines.map((l) => `${l.qty} × ${l.productName}`).join(", ");
    const parts = [when, `Venta ${formatCop(entry.saleTotal)}`];
    if (entry.amountReceived > 0) parts.push(`Pagó ahora ${formatCop(entry.amountReceived)}`);
    if (items) parts.push(items);
    return parts.join(" · ");
  }
  if ((entry.kind === "inicial" || entry.kind === "abono") && entry.note) return `${when} · Nota: ${entry.note}`;
  return when;
}

/** ESTADO DE CUENTA as RowGroup. Cargos «+» danger, abonos «−» ok, always with a word. */
export function DebtStatementView({ statement }: { statement: DebtStatement }) {
  const rows = [...statement.entries].reverse();
  return (
    <section className="flex flex-col gap-2">
      <SectionHead title="Estado de cuenta" />
      {rows.length === 0 ? (
        <RowGroupNote>Aún no hay movimientos de fiado.</RowGroupNote>
      ) : (
        <RowGroup label="Estado de cuenta">
          {rows.map((entry) => {
            const v = statementRow(entry);
            return (
              <Row
                key={entry.id}
                href={v.href ?? undefined}
                title={v.label}
                meta={entryMeta(entry)}
                trailing={
                  <>
                    <span className={`text-[15px] font-semibold tabular-nums ${v.tone === "danger" ? "text-danger" : "text-ok"}`}>
                      {v.sign} {formatCop(v.amount)}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {v.word} · Saldo {formatCop(entry.runningBalance)}
                    </span>
                  </>
                }
              />
            );
          })}
        </RowGroup>
      )}
      {statement.charged > 0 ? (
        <p className="px-1 text-xs tabular-nums text-ink-muted">
          Cargado {formatCop(statement.charged)}
          {statement.paid > 0 ? ` · Pagos y devoluciones ${formatCop(statement.paid)}` : ""} · Total pendiente{" "}
          {formatCop(statement.total)}
        </p>
      ) : null}
    </section>
  );
}
