import Link from "next/link";
import { formatCop } from "@/domain/money";
import { formatBogotaDateTime } from "@/domain/debt/statement";
import { CASH_COPY } from "@/domain/cash";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

/** Existing home shortcuts only. Nueva venta stays the primary action. */
const QUICK_LINKS = [
  { href: "/clientes", label: "Fiados", icon: "users" },
  { href: "/mas/caja", label: "Caja", icon: "cash" },
  { href: "/inventario", label: "Inventario", icon: "package" },
] as const;

type Glyph = "alert" | "package" | "users" | "cash" | "bag" | "plus";

function GlyphIcon({ name }: { name: Glyph }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "alert":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v5" />
          <path d="M12 16.5h.01" />
        </svg>
      );
    case "package":
      return (
        <svg {...common}>
          <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.25" />
          <path d="M2.5 19c.6-3.2 2.9-5 6.5-5s5.9 1.8 6.5 5" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M16 14c2.4.3 4.2 1.5 4.8 4" />
        </svg>
      );
    case "cash":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.25" />
          <path d="M6 10v.01M18 14v.01" />
        </svg>
      );
    case "bag":
      return (
        <svg {...common}>
          <path d="M6 8h12l-1 12H7L6 8z" />
          <path d="M9 8V7a3 3 0 0 1 6 0v1" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
  }
}

function Chevron() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 opacity-70"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function bogotaWeekdayIndex(date = new Date()): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
  }).format(date);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  return index === -1 ? 0 : index;
}

function cajaCopy(snap: DashboardSnapshot): { value: string; label: string } {
  if (snap.cajaState === "open") {
    return {
      value: formatCop(snap.cajaExpectedEfectivo ?? 0),
      label: CASH_COPY.cajaEsperado,
    };
  }
  if (snap.cajaState === "closed") {
    return { value: CASH_COPY.estadoCerrada, label: "Caja" };
  }
  return { value: CASH_COPY.estadoSinAbrir, label: "Caja" };
}

function salesCaption(count: number): string {
  if (count === 0) return "Sin ventas registradas hoy";
  return `${count} ${count === 1 ? "venta" : "ventas"}`;
}

function WeekRail() {
  const today = bogotaWeekdayIndex();
  const name = WEEKDAYS[today];
  return (
    <div aria-label={`Hoy es ${name}. Las ventas de esta pantalla son solo de hoy.`}>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((label, i) => {
          const active = i === today;
          return (
            <div key={label} className="flex min-w-0 flex-col items-center gap-2">
              <span
                className={`h-1.5 w-full rounded-full ${active || i < today ? "bg-cta" : "bg-border"}`}
              />
              <span
                className={`truncate text-xs leading-none ${
                  active ? "font-semibold text-ink" : "text-ink-muted"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({
  href,
  icon,
  value,
  label,
  tone = "neutral",
}: {
  href: string;
  icon: Glyph;
  value: string;
  label: string;
  tone?: "neutral" | "danger" | "ok";
}) {
  const well =
    tone === "danger"
      ? "bg-danger-soft text-danger"
      : tone === "ok"
        ? "bg-ok-soft text-ok"
        : "bg-surface-2 text-ink";
  return (
    <Link
      href={href}
      className="flex min-h-[4.5rem] min-w-0 items-center gap-3 rounded-[var(--r-lg)] bg-surface p-3 shadow-[var(--shadow-sm)]"
    >
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${well}`}>
        <GlyphIcon name={icon} />
      </span>
      <span className="min-w-0">
        <span className="block break-words text-lg font-semibold leading-tight tabular-nums text-ink">
          {value}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-muted">{label}</span>
      </span>
    </Link>
  );
}

function ActionBanner({
  href,
  icon,
  title,
  detail,
  tone,
}: {
  href: string;
  icon: Glyph;
  title: string;
  detail: string;
  tone: "ink" | "surface";
}) {
  const surface = tone === "ink";
  return (
    <Link
      href={href}
      className={`flex min-h-16 items-center gap-3 rounded-[var(--r-lg)] px-3 py-3 shadow-[var(--shadow-sm)] ${
        surface ? "bg-ink text-bg" : "border border-border bg-surface text-ink"
      }`}
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
          surface ? "bg-surface text-ink" : "bg-primary text-ink"
        }`}
      >
        <GlyphIcon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug">{title}</span>
        <span className={`mt-0.5 block text-xs leading-snug ${surface ? "opacity-75" : "text-ink-muted"}`}>
          {detail}
        </span>
      </span>
      <Chevron />
    </Link>
  );
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
  const ventas = salesCaption(snap.todaySalesCount);
  const quick = QUICK_LINKS.map((item) =>
    item.href === "/inventario" && snap.lowStockCount > 0
      ? { ...item, label: "Stock bajo" }
      : item,
  );

  const primaryBanner =
    snap.todaySalesCount === 0
      ? {
          href: "/ventas/nueva",
          icon: "bag" as const,
          title: "Registra una venta",
          detail: "Todavía no hay ventas hoy",
        }
      : {
          href: "/ventas",
          icon: "bag" as const,
          title: "Ventas de hoy",
          detail: ventas,
        };

  const secondaryBanner =
    snap.productCount === 0
      ? {
          href: "/inventario/nuevo",
          icon: "plus" as const,
          title: "Agrega el primer producto",
          detail: "El catálogo está vacío",
        }
      : snap.debtTotal > 0
        ? {
            href: "/clientes",
            icon: "users" as const,
            title: "Por cobrar",
            detail: `${formatCop(snap.debtTotal)} · ${snap.debtorCount} ${
              snap.debtorCount === 1 ? "cliente" : "clientes"
            }`,
          }
        : snap.lowStockCount > 0
          ? {
              href: "/inventario",
              icon: "package" as const,
              title: "Poco stock",
              detail: `${snap.lowStockCount} ${
                snap.lowStockCount === 1 ? "producto" : "productos"
              } en el umbral`,
            }
          : {
              href: "/mas/caja",
              icon: "cash" as const,
              title: caja.label,
              detail: caja.value,
            };

  return (
    <div className="flex flex-col">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-ink">
            {snap.greeting}
          </h1>
          {snap.businessLabel ? (
            <p className="mt-1 truncate text-sm text-ink-muted">{snap.businessLabel}</p>
          ) : null}
          <p className="mt-0.5 text-xs text-ink-muted">{snap.dateLabel}</p>
        </div>
        <Link
          href="/ventas/nueva"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--r-pill)] border border-border bg-surface px-3 text-sm font-semibold text-ink shadow-[var(--shadow-sm)]"
        >
          <GlyphIcon name="plus" />
          <span className="max-[359px]:sr-only">Nueva venta</span>
        </Link>
      </header>

      <section className="mt-8" aria-label="Ventas de hoy">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Hoy</p>
          <p className="text-sm text-ink-muted">{ventas}</p>
        </div>
        <Link href="/ventas" className="mt-2 block">
          <p className="break-all text-5xl font-semibold leading-none tracking-tight tabular-nums text-ink max-[359px]:text-4xl">
            {formatCop(snap.todaySalesTotal)}
          </p>
        </Link>
        <div className="mt-8">
          <WeekRail />
        </div>
        <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Ventas de hoy
          </p>
          <p className="text-sm font-semibold tabular-nums text-ink">
            {formatCop(snap.todaySalesTotal)}
          </p>
        </div>
        <div className="mt-2 flex justify-end">
          <Link href="/mas/estadisticas" className="text-xs font-semibold text-cta">
            Ver estadísticas
          </Link>
        </div>
      </section>

      <section className="-mx-4 mt-6 flex flex-col gap-6 rounded-t-3xl bg-surface-2 px-4 pb-2 pt-5">
        <div className="grid grid-cols-2 gap-3" aria-label="Señales del día">
          <MetricCard
            href="/inventario"
            icon="alert"
            value={String(snap.lowStockCount)}
            label="Stock bajo"
            tone={snap.lowStockCount > 0 ? "danger" : "neutral"}
          />
          <MetricCard
            href="/inventario"
            icon="package"
            value={String(snap.productCount)}
            label="Productos"
          />
          <MetricCard
            href="/clientes"
            icon="users"
            value={formatCop(snap.debtTotal)}
            label="Por cobrar"
            tone={snap.debtTotal > 0 ? "danger" : "neutral"}
          />
          <MetricCard
            href="/mas/caja"
            icon="cash"
            value={caja.value}
            label={caja.label}
            tone={snap.cajaState === "open" ? "ok" : "neutral"}
          />
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Accesos rápidos
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {quick.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-[5.75rem] flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] bg-surface px-2 py-3 text-center shadow-[var(--shadow-sm)]"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-cta">
                  <GlyphIcon name={item.icon} />
                </span>
                <span className="text-xs font-semibold leading-tight text-ink">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3" aria-label="Acciones">
          <ActionBanner {...primaryBanner} tone="ink" />
          <ActionBanner {...secondaryBanner} tone="surface" />
        </div>

        <section className="flex flex-col gap-2" aria-label="Fiados pendientes">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Fiados pendientes
            </h2>
            <Link href="/clientes" className="text-xs font-semibold text-cta">
              Ver todos
            </Link>
          </div>
          {snap.debtorCount === 0 ? (
            <p className="rounded-[var(--r-lg)] bg-surface px-3 py-2.5 text-sm text-ink-muted shadow-[var(--shadow-sm)]">
              Nadie debe…
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {snap.debtors.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/clientes/${c.id}`}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--r-lg)] bg-surface px-3 py-2.5 shadow-[var(--shadow-sm)]"
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
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Atención en inventario
            </h2>
            <Link href="/inventario" className="text-xs font-semibold text-cta">
              Ver inventario
            </Link>
          </div>
          {snap.lowStockCount === 0 ? (
            <p className="rounded-[var(--r-lg)] bg-surface px-3 py-2.5 text-sm text-ink-muted shadow-[var(--shadow-sm)]">
              Nada en poco stock
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {snap.lowStock.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/inventario/${p.id}`}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--r-lg)] bg-surface px-3 py-2.5 shadow-[var(--shadow-sm)]"
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
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Actividad reciente
          </h2>
          {snap.activity.length === 0 ? (
            <p className="rounded-[var(--r-lg)] bg-surface px-3 py-2.5 text-sm text-ink-muted shadow-[var(--shadow-sm)]">
              Todavía no hay actividad registrada.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {snap.activity.map((row) => (
                <li key={row.id}>
                  <Link
                    href={row.href ?? "/"}
                    className="flex min-h-11 items-start justify-between gap-3 rounded-[var(--r-lg)] bg-surface px-3 py-2.5 shadow-[var(--shadow-sm)]"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{row.title}</span>
                      {row.detail ? (
                        <span className="block truncate text-xs text-ink-muted">{row.detail}</span>
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
                        {row.kind === "pago" || row.kind === "devolucion" ? "−" : ""}
                        {formatCop(row.amount)}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {snap.emptyDb && onLoadDemo ? (
          <Button type="button" variant="secondary" onClick={onLoadDemo} className="bg-primary">
            Cargar demo
          </Button>
        ) : null}
      </section>

      {toast && (
        <div className="fixed bottom-[calc(9.5rem+env(safe-area-inset-bottom))] left-1/2 z-[70] max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-center text-sm text-bg">
          {toast}
        </div>
      )}
    </div>
  );
}

export function InicioSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Cargando">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="h-7 w-40 rounded bg-surface-2" />
          <div className="mt-2 h-4 w-28 rounded bg-surface-2" />
        </div>
        <div className="h-11 w-28 rounded-full bg-surface-2" />
      </div>
      <div className="mt-8 h-4 w-16 rounded bg-surface-2" />
      <div className="mt-3 h-12 w-40 rounded bg-surface-2" />
      <div className="mt-8 grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-1.5 rounded-full bg-surface-2" />
        ))}
      </div>
      <div className="-mx-4 mt-6 grid grid-cols-2 gap-3 rounded-t-3xl bg-surface-2 px-4 py-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[4.5rem] rounded-[var(--r-lg)] bg-surface" />
        ))}
      </div>
    </div>
  );
}
