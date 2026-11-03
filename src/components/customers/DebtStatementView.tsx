import { Badge } from "@/components/ui/Badge";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { SectionHead } from "@/components/ui/SectionHead";
import { formatCop } from "@/domain/money";
import { type DebtEntry, type DebtStatement } from "@/domain/debt/statement";
import { shortDateTime, statementRow } from "./clientes";

function entryMeta(entry: DebtEntry): string {
  const when = shortDateTime(entry.createdAt);
  if (entry.kind === "fiada" || entry.kind === "parcial") {
    // One line: sale total and what was paid stay separate from the fiado (trailing amount).
    const parts = [when, `Venta ${formatCop(entry.saleTotal)}`];
    if (entry.amountReceived > 0) parts.push(`Pagó ${formatCop(entry.amountReceived)}`);
    return parts.join(" · ");
  }
  if (entry.kind === "abono") {
    const parts = [when];
    if (entry.syncState === "rejected") parts.push("No aplicado en el servidor");
    if (entry.otherDay) {
      parts.push(`Registrado el ${dayLabel(entry.otherDay.occurredOn)}, entró a la caja del ${dayLabel(entry.otherDay.appliedOn)}`);
    }
    if (entry.note) parts.push(`Nota: ${entry.note}`);
    return parts.join(" · ");
  }
  if (entry.kind === "inicial" && entry.note) return `${when} · Nota: ${entry.note}`;
  return when;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function dayLabel(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : key;
}

/** C01 — state badge of an abono row: always icon-free text + tone (never color alone). */
function AbonoBadge({ entry }: { entry: DebtEntry }) {
  if (entry.kind !== "abono") return null;
  if (entry.syncState === "rejected") return <Badge tone="danger">Rechazada</Badge>;
  if (entry.syncState === "pending") return <Badge tone="warning">Pendiente</Badge>;
  if (entry.otherDay) return <Badge tone="info">De otro día</Badge>;
  return null;
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
                    <AbonoBadge entry={entry} />
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
