"use client";

import { CustomerChrome, PortalError, PortalLoading } from "@/components/customer/CustomerChrome";
import { usePortalLedger } from "@/components/customer/usePortalLedger";
import { newestFirst } from "@/components/customer/portal";
import { formatCop } from "@/domain/money";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";

export default function CustomerPaymentsPage() {
  const { ledger, capturedAt, fromCache, error, reload } = usePortalLedger();

  if (error) {
    return (
      <CustomerChrome title="Pagos">
        <PortalError message={error} onRetry={reload} />
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Pagos">
        <PortalLoading />
      </CustomerChrome>
    );
  }

  const payments = newestFirst(ledger.payments);
  const initials = ledger.initials;

  return (
    <CustomerChrome title="Pagos" capturedAt={fromCache ? capturedAt : null}>
      <section className="flex flex-col gap-2">
        <SectionHead title="Abonos" />
        {payments.length === 0 ? (
          <RowGroupNote>No hay pagos registrados.</RowGroupNote>
        ) : (
          <RowGroup label="Abonos">
            {payments.map((p) => (
              <Row
                key={p.id}
                title={p.method}
                meta={p.occurredOn}
                trailing={
                  <>
                    <span className="text-[15px] font-semibold tabular-nums text-ok">− {formatCop(p.amount)}</span>
                    <span className="text-xs text-ink-muted">Baja tu deuda</span>
                  </>
                }
              />
            ))}
          </RowGroup>
        )}
      </section>
      {initials.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionHead title="Deuda anterior" />
          <RowGroup label="Deuda anterior">
            {initials.map((d) => (
              <Row
                key={d.id}
                title="Deuda anterior"
                meta={[d.occurredOn, d.note].filter(Boolean).join(" · ")}
                trailing={
                  <>
                    <span className="text-[15px] font-semibold tabular-nums text-danger">+ {formatCop(d.amount)}</span>
                    <span className="text-xs text-ink-muted">Sube tu deuda</span>
                  </>
                }
              />
            ))}
          </RowGroup>
        </section>
      ) : null}
    </CustomerChrome>
  );
}
