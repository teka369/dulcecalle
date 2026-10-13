"use client";

import { CustomerChrome, PortalError, PortalLoading } from "@/components/customer/CustomerChrome";
import { usePortalLedger } from "@/components/customer/usePortalLedger";
import { debtHero } from "@/components/customer/portal";
import { customerPortalSummary, customerPortalTotals } from "@/data/pwa/customer-portal";
import { formatCop } from "@/domain/money";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { SegmentedMetrics } from "@/components/ui/SegmentedMetrics";
import { QuickTiles } from "@/components/ui/QuickTiles";

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
      <SegmentedMetrics
        label="Tus totales"
        items={[
          { icon: "bag", label: "Total comprado", value: formatCop(totalComprado) },
          { icon: "cash", label: "Total abonado", value: formatCop(totalAbonado), tone: "ok" },
        ]}
      />
      <QuickTiles
        tiles={[
          { href: "/cliente/cuenta", label: "Cuenta", icon: "clock" },
          { href: "/cliente/compras", label: "Compras", icon: "bag" },
          { href: "/cliente/pagos", label: "Pagos", icon: "cash" },
        ]}
      />
      <p className="text-xs text-ink-muted">
        Última actualización{" "}
        {capturedAt ? new Date(capturedAt).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
      </p>
    </CustomerChrome>
  );
}
