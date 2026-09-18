import Link from "next/link";
import { formatCop } from "@/domain/money";
import {
  entryTitle,
  formatBogotaDateTime,
  type DebtEntry,
  type DebtStatement,
} from "@/domain/debt/statement";

function EntryCard({ entry }: { entry: DebtEntry }) {
  if (entry.kind === "inicial") {
    return (
      <article className="rounded-2xl border border-ink/[0.08] border-l-4 border-l-ink/40 bg-surface p-4">
        <p className="text-sm font-semibold">{entryTitle(entry)}</p>
        <p className="mt-0.5 text-xs text-ink/55">
          {formatBogotaDateTime(entry.createdAt)}
        </p>
        <p className="mt-3 text-lg font-semibold tabular-nums text-accent">
          {formatCop(entry.amount)}
        </p>
        {entry.note ? (
          <p className="mt-2 break-words text-sm text-ink/70">
            Nota: {entry.note}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink/50">
            Saldo anterior, sin productos.
          </p>
        )}
        <p className="mt-3 text-xs tabular-nums text-ink/50">
          Saldo después: {formatCop(entry.runningBalance)}
        </p>
      </article>
    );
  }

  if (entry.kind === "abono") {
    return (
      <article className="rounded-2xl border border-ok/25 border-l-4 border-l-ok bg-surface p-4">
        <p className="text-sm font-semibold">{entryTitle(entry)}</p>
        <p className="mt-0.5 text-xs text-ink/55">
          {formatBogotaDateTime(entry.createdAt)} · {entry.method}
        </p>
        <p className="mt-3 text-lg font-semibold tabular-nums text-ok">
          −{formatCop(entry.amount)}
        </p>
        <p className="mt-3 text-xs tabular-nums text-ink/50">
          Saldo después: {formatCop(entry.runningBalance)}
        </p>
      </article>
    );
  }

  if (entry.kind === "devolucion") {
    return (
      <article className="rounded-2xl border border-ok/25 border-l-4 border-l-ok bg-surface p-4">
        <p className="text-sm font-semibold">{entryTitle(entry)}</p>
        <p className="mt-0.5 text-xs text-ink/55">
          {formatBogotaDateTime(entry.createdAt)}
        </p>
        <p className="mt-3 text-lg font-semibold tabular-nums text-ok">
          −{formatCop(entry.amount)}
        </p>
        <p className="mt-3 text-xs tabular-nums text-ink/50">
          Saldo después: {formatCop(entry.runningBalance)}
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-ink/[0.08] border-l-4 border-l-accent bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{entryTitle(entry)}</p>
          <p className="mt-0.5 text-xs text-ink/55">
            {formatBogotaDateTime(entry.createdAt)}
          </p>
        </div>
        <Link
          href={`/ventas/${entry.saleId}`}
          className="shrink-0 pt-0.5 text-xs font-semibold text-cta underline underline-offset-2"
        >
          Ver venta
        </Link>
      </div>
      {entry.lines.length === 0 ? (
        <p className="mt-3 text-sm text-ink/60">
          Esta venta no tiene líneas de producto.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {entry.lines.map((line, i) => (
            <li
              key={`${entry.saleId}-${i}`}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="min-w-0 break-words">
                <span className="font-medium">
                  {line.qty} × {line.productName}
                </span>
                <span className="mt-0.5 block text-xs tabular-nums text-ink/50">
                  {formatCop(line.unitPrice)} c/u
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatCop(line.lineTotal)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-3 space-y-1 border-t border-ink/10 pt-3 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-ink/60">Subtotal</dt>
          <dd className="shrink-0 font-medium tabular-nums">
            {formatCop(entry.saleTotal)}
          </dd>
        </div>
        {entry.amountReceived > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-ink/60">Pagó ahora</dt>
            <dd className="shrink-0 font-medium tabular-nums text-ok">
              −{formatCop(entry.amountReceived)}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-ink/60">Quedó fiado</dt>
          <dd className="shrink-0 font-semibold tabular-nums text-accent">
            {formatCop(entry.credit)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs tabular-nums text-ink/50">
        Saldo después: {formatCop(entry.runningBalance)}
      </p>
    </article>
  );
}

export function DebtStatementView({ statement }: { statement: DebtStatement }) {
  const pending = statement.total > 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
            Total pendiente
          </p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
              pending ? "bg-accent/15 text-accent" : "bg-ok/15 text-ok"
            }`}
          >
            {pending ? "Pendiente" : "Al día"}
          </span>
        </div>
        <p
          className={`mt-1 break-all text-3xl font-semibold tabular-nums ${
            pending ? "text-accent" : "text-ink"
          }`}
        >
          {formatCop(statement.total)}
        </p>
        {statement.charged > 0 && (
          <p className="mt-2 text-xs text-ink/55">
            Cargado {formatCop(statement.charged)}
            {statement.paid > 0
              ? ` · Pagos y devoluciones ${formatCop(statement.paid)}`
              : ""}
          </p>
        )}
      </section>

      {statement.entries.length === 0 ? (
        <p className="text-sm text-ink/60">Aún no hay movimientos de fiado.</p>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink/60">De qué es el fiado</h2>
          {statement.entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </section>
      )}

      {statement.entries.length > 0 && (
        <section className="rounded-2xl border border-ink/[0.08] bg-surface px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold">Total pendiente</span>
            <span
              className={`shrink-0 text-base font-semibold tabular-nums ${
                pending ? "text-accent" : "text-ink"
              }`}
            >
              {formatCop(statement.total)}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
