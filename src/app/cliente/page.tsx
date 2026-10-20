"use client";

import { CustomerChrome, PortalError, PortalLoading } from "@/components/customer/CustomerChrome";
import { usePortalLedger } from "@/components/customer/usePortalLedger";
import { debtHero } from "@/components/customer/portal";
import { customerPortalSummary, customerPortalTotals } from "@/data/pwa/customer-portal";
import { formatCop } from "@/domain/money";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";

export default function CustomerHomePage() {
  // loadCachedCustomerLedger via usePortalLedger (server, else own cache; capturedAt → offline band).
  const { ledger, capturedAt, fromCache, error, reload } = usePortalLedger();

  if (error) {
    return (
      <CustomerChrome title="Tu consulta" size="tall">
        <PortalError message={error} onRetry={reload} />
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Tu consulta" size="tall">
        <PortalLoading />
      </CustomerChrome>
    );
  }

  const summary = customerPortalSummary(ledger);
  const debt = debtHero(ledger);
  const { totalComprado, totalAbonado } = customerPortalTotals(ledger);

  return (
    <CustomerChrome
      title="Tu consulta"
      size="tall"
      capturedAt={fromCache ? capturedAt : null}
      subtitle={<>Hola, {summary.name} · {summary.code}</>}
      hero={
        <div className="mt-5">
          {/* summary.debt is the server balance, never totals of abonos */}
          <HeroAmount
            label={debt.label}
            value={formatCop(summary.debt)}
            tone={debt.owes ? "danger" : "ok"}
          />
          <p className="mt-2 text-sm text-on-hero-muted">{debt.caption}</p>
        </div>
      }
    >
      {/* Metrics and shortcuts are rows with dividers in the sheet, not floating cards. */}
      <RowGroup label="Tus totales">
        <Row
          title="Total comprado"
          trailing={<span className="text-[15px] font-semibold tabular-nums">{formatCop(totalComprado)}</span>}
        />
        <Row
          title="Total abonado"
          trailing={<span className="text-[15px] font-semibold tabular-nums text-ok">{formatCop(totalAbonado)}</span>}
        />
      </RowGroup>
      <RowGroup label="Accesos">
        <Row href="/cliente/cuenta" title="Cuenta" meta="Movimientos y saldo" />
        <Row href="/cliente/compras" title="Compras" meta="Lo que has comprado" />
        <Row href="/cliente/pagos" title="Pagos" meta="Abonos y deuda anterior" />
      </RowGroup>
      <p className="text-xs text-ink-muted">
        Última actualización{" "}
        {capturedAt ? new Date(capturedAt).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
      </p>
    </CustomerChrome>
  );
}
