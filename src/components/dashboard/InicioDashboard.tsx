import Link from "next/link";
import { formatCop } from "@/domain/money";
import { formatBogotaDateTime } from "@/domain/debt/statement";
import { CASH_COPY } from "@/domain/cash";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

/** Zona Ahora — existing routes only (AUDIT §7 / SPECS U1 wire). FAB stays global primary. */
const AHORA_ACTIONS = [
  { href: "/ventas/nueva", label: "Nueva venta" },
  { href: "/mas/caja", label: "Caja" },
  { href: "/clientes", label: "Fiados" },
  { href: "/inventario", label: "Surtir" },
] as const;

function SignalChip({
  label,
  value,
  caption,
  tone = "ink",
  href,
}: {
  label: string;
  value: string;
  caption: string;
  tone?: "ink" | "accent" | "ok" | "danger";
  href?: string;
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent"
      : tone === "ok"
        ? "text-ok"
        : tone === "danger"
          ? "text-danger"
          : "text-ink";
  const body = (
    <Card className="p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p
        className={`mt-1 break-all text-sm font-semibold leading-tight tabular-nums ${toneClass}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs leading-snug text-ink-muted">{caption}</p>
    </Card>
  );
  if (href) {
    return (
      <Link href={href} className="block min-w-0">
        {body}
      </Link>
    );
  }
  return <div className="min-w-0">{body}</div>;
}

function cajaCopy(snap: DashboardSnapshot): {
  value: string;
  caption: string;
  tone: "ink" | "ok";
} {
  if (snap.cajaState === "open") {
    return {
      value: formatCop(snap.cajaExpectedEfectivo ?? 0),
      caption: CASH_COPY.cajaEsperado,
      tone: "ok",
    };
  }
  if (snap.cajaState === "closed") {
    return {
      value: CASH_COPY.estadoCerrada,
      caption: "El día ya se cerró",
      tone: "ink",
    };
  }
  return {
    value: CASH_COPY.estadoSinAbrir,
    caption: "No hay una sesión activa",
    tone: "ink",
  };
}

function heroFor(snap: DashboardSnapshot): {
  label: string;
  value: string;
  caption: string;
  href: string;
  cta: string;
  tone: "accent" | "ink";
} {
  // U1 hero rule: debt / por cobrar > 0 → Por cobrar; else Ventas hoy.
  if (snap.debtTotal > 0) {
    const caption =
      snap.debtorCount === 0
        ? "Nadie debe…"
        : `${snap.debtorCount} ${snap.debtorCount === 1 ? "cliente" : "clientes"}`;
    return {
      label: "Por cobrar",
      value: formatCop(snap.debtTotal),
      caption,
      href: "/clientes",
      cta: "Ir a Clientes",
      tone: "accent",
    };
  }
  const caption =
    snap.todaySalesCount === 0
      ? "Sin ventas registradas hoy"
      : `${snap.todaySalesCount} ${snap.todaySalesCount === 1 ? "venta" : "ventas"}`;
  return {
    label: "Ventas hoy",
    value: formatCop(snap.todaySalesTotal),
    caption,
    href: "/ventas",
    cta: "Ir a Ventas",
    tone: "ink",
  };
}

export function InicioDashboard({
  snap,
  onLoadDemo,
  toast,
}: {
  snap: DashboardSnapshot;
  onLoadDemo?: () => void;
  toast: string | null;
}) {
  const caja = cajaCopy(snap);
  const hero = heroFor(snap);
  const salesCaption =
    snap.todaySalesCount === 0
      ? "Sin ventas registradas hoy"
      : `${snap.todaySalesCount} ${snap.todaySalesCount === 1 ? "venta" : "ventas"}`;
  const stockCaption =
    snap.productCount === 0
      ? "Sin productos en catálogo"
      : snap.lowStockCount === 0
        ? "Nada en poco stock"
        : `${snap.lowStockCount} con poco stock`;

  const subtitleParts = [snap.greeting, snap.dateLabel];
  if (snap.businessLabel) subtitleParts.push(snap.businessLabel);
  const subtitle = subtitleParts.join(" · ");

  const ahoraActions = AHORA_ACTIONS.map((a) =>
    a.href === "/inventario" && snap.lowStockCount > 0
      ? { ...a, label: "Stock bajo" }
      : a,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Inicio" subtitle={subtitle} />

      {/* Hero — one navigation signal (not page primary CTA; FAB stays global) */}
      <section aria-label="Señal principal">
        <Link href={hero.href} className="block">
          <Card className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              {hero.label}
            </p>
            <p
              className={`mt-1 break-all text-2xl font-semibold leading-tight tabular-nums ${
                hero.tone === "accent" ? "text-accent" : "text-ink"
              }`}
            >
              {hero.value}
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <p className="text-sm leading-snug text-ink-muted">{hero.caption}</p>
              <span className="shrink-0 text-xs font-semibold text-cta">
                {hero.cta} →
              </span>
            </div>
          </Card>
        </Link>
      </section>

      {/* Signal row — ventas ≠ caja ≠ stock (S5); existing snapshot fields only */}
      <section
        className="grid grid-cols-3 gap-2"
        aria-label="Señales del día"
      >
        <SignalChip
          label="Ventas hoy"
          value={formatCop(snap.todaySalesTotal)}
          caption={salesCaption}
          href="/ventas"
        />
        <SignalChip
          label="Caja"
          value={caja.value}
          caption={caja.caption}
          tone={caja.tone}
          href="/mas/caja"
        />
        <SignalChip
          label="Inventario"
          value={String(snap.productCount)}
          caption={stockCaption}
          tone={snap.lowStockCount > 0 ? "danger" : "ink"}
          href="/inventario"
        />
      </section>

      {/* Zona Ahora — shortcuts to locked flows; secondary only */}
      <section className="flex flex-col gap-2" aria-label="Ahora">
        <h2 className="text-sm font-semibold text-ink-muted">Ahora</h2>
        <div className="grid grid-cols-2 gap-2">
          {ahoraActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="inline-flex h-11 min-h-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface px-4 text-center text-sm font-semibold text-ink transition-opacity hover:opacity-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </section>

      {/* Short lists — after hero / shortcuts */}
      <section className="flex flex-col gap-2" aria-label="Fiados pendientes">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-muted">
            Fiados pendientes
          </h2>
          <Link
            href="/clientes"
            className="text-xs font-semibold text-cta underline underline-offset-2"
          >
            Ver todos
          </Link>
        </div>
        {snap.debtorCount === 0 ? (
          <p className="rounded-[var(--r-lg)] border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted shadow-[var(--shadow-sm)]">
            Nadie debe…
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snap.debtors.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clientes/${c.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--r-lg)] border border-border bg-surface px-3 py-2.5 shadow-[var(--shadow-sm)]"
                >
                  <span className="min-w-0 truncate font-medium">{c.name}</span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums text-accent">
                      {formatCop(c.debt)}
                    </span>
                    <Badge tone="info">Pendiente</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Atención en inventario">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-muted">
            Atención en inventario
          </h2>
          <Link
            href="/inventario"
            className="text-xs font-semibold text-cta underline underline-offset-2"
          >
            Ver inventario
          </Link>
        </div>
        {snap.lowStockCount === 0 ? (
          <p className="rounded-[var(--r-lg)] border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted shadow-[var(--shadow-sm)]">
            Nada en poco stock
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snap.lowStock.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/inventario/${p.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--r-lg)] border border-border bg-surface px-3 py-2.5 shadow-[var(--shadow-sm)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="text-xs text-danger">
                      Poco stock · umbral {p.lowStockAt}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {p.stock} u.
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Actividad reciente">
        <h2 className="text-sm font-semibold text-ink-muted">Actividad reciente</h2>
        {snap.activity.length === 0 ? (
          <p className="rounded-[var(--r-lg)] border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted shadow-[var(--shadow-sm)]">
            Todavía no hay actividad registrada.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snap.activity.map((row) => (
              <li key={row.id}>
                <Link
                  href={row.href ?? "/"}
                  className="flex min-h-11 items-start justify-between gap-3 rounded-[var(--r-lg)] border border-border bg-surface px-3 py-2.5 shadow-[var(--shadow-sm)]"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{row.title}</span>
                    {row.detail ? (
                      <span className="block truncate text-xs text-ink-muted">
                        {row.detail}
                      </span>
                    ) : null}
                    <span className="block text-xs text-ink-muted">
                      {formatBogotaDateTime(row.at)}
                    </span>
                  </span>
                  {row.amount != null ? (
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        row.kind === "pago" || row.kind === "devolucion"
                          ? "text-ok"
                          : row.kind === "fiado" || row.kind === "inicial"
                            ? "text-accent"
                            : "text-ink"
                      }`}
                    >
                      {row.kind === "pago" || row.kind === "devolucion"
                        ? "−"
                        : ""}
                      {formatCop(row.amount)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {snap.emptyDb &&
        (onLoadDemo ? (
          <Button
            type="button"
            variant="secondary"
            onClick={onLoadDemo}
            className="bg-primary"
          >
            Cargar demo
          </Button>
        ) : (
          <Link
            href="/inventario/nuevo"
            className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
          >
            Agregar el primer producto
          </Link>
        ))}

      {toast && (
        <div className="fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

export function InicioSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando">
      <div>
        <div className="h-6 w-28 rounded bg-surface-2" />
        <div className="mt-2 h-4 w-48 rounded bg-surface-2" />
      </div>
      <div className="h-[6.5rem] rounded-[var(--r-lg)] border border-border bg-surface shadow-[var(--shadow-sm)]" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-[5.25rem] rounded-[var(--r-lg)] border border-border bg-surface shadow-[var(--shadow-sm)]"
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`a-${i}`}
            className="h-11 rounded-[var(--r-md)] border border-border bg-surface"
          />
        ))}
      </div>
    </div>
  );
}
