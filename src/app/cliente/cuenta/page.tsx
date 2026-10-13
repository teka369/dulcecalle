"use client";

import { CustomerChrome, PortalError, PortalLoading } from "@/components/customer/CustomerChrome";
import { usePortalLedger } from "@/components/customer/usePortalLedger";
import { debtHero, statementSign } from "@/components/customer/portal";
import { customerStatementRows } from "@/data/pwa/customer-portal";
import { formatCop } from "@/domain/money";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";

export default function CustomerStatementPage() {
  const { ledger, capturedAt, fromCache, error, reload } = usePortalLedger();

  if (error) {
    return (
      <CustomerChrome title="Estado de cuenta">
        <PortalError message={error} onRetry={reload} />
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Estado de cuenta">
        <PortalLoading />
      </CustomerChrome>
    );
  }

  const rows = customerStatementRows(ledger);
  const debt = debtHero(ledger);

  return (
    <CustomerChrome
      title="Estado de cuenta"
      capturedAt={fromCache ? capturedAt : null}
      hero={
        <div className="mt-4">
          <HeroAmount label={debt.label} value={formatCop(ledger.customer.debt)} tone={debt.owes ? "danger" : "ok"} />
        </div>
      }
    >
      {rows.length === 0 ? (
        <StateBlock
          kind="empty"
          title="Todavía no tienes movimientos registrados."
          body="Cuando compres o abones, aparecerán aquí."
        />
      ) : (
        <RowGroup label="Movimientos">
          {rows.map((row) => {
            const sg = statementSign(row);
            return (
              <Row
                key={row.id}
                href={row.href}
                title={row.title}
                meta={row.occurredOn}
                trailing={
                  <>
                    <span className={`text-[15px] font-semibold tabular-nums ${sg.tone === "ok" ? "text-ok" : "text-danger"}`}>
                      {sg.sign} {formatCop(row.amount)}
                    </span>
                    <span className="text-xs text-ink-muted">{sg.word}</span>
                  </>
                }
              />
            );
          })}
        </RowGroup>
      )}
    </CustomerChrome>
  );
}
