"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { formatCop } from "@/domain/money";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";
import { weekTotal, type WeekDay } from "@/domain/dashboard/week";
import { loadWeekSeries } from "./week-source";
import { syncThemeColor } from "@/theme/storage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

/** Existing home shortcuts only. Nueva venta stays the primary action. */
const QUICK_LINKS = [
  { href: "/clientes", label: "Fiados", icon: "users" },
  { href: "/inventario", label: "Surtir", icon: "package" },
  { href: "/mas/gastos", label: "Gastos", icon: "bag" },
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

function salesCaption(count: number): string {
  if (count === 0) return "Sin ventas registradas hoy";
  return `${count} ${count === 1 ? "venta" : "ventas"}`;
}

/** Hero pill: Caja state (existing data, existing routes). */
function cajaPill(snap: DashboardSnapshot): {
  href: string;
  label: string;
  dot: string | null;
} {
  switch (snap.cajaState) {
    case "open":
      return { href: "/mas/caja", label: "Caja abierta", dot: "bg-ok" };
    case "pending":
      return { href: "/mas/caja/gestionar", label: "Caja pendiente", dot: "bg-warning" };
    case "conflict":
      return { href: "/mas/caja", label: "Revisar caja", dot: "bg-danger" };
    default:
      return { href: "/mas/caja", label: "Abrir caja", dot: null };
  }
}

/**
 * 7-day series only when this business's local sales history is prepared;
 * null → spec fallback (no chart, «Ventas de hoy»).
 */
function useWeekSeries(todayTotal: number): WeekDay[] | null {
  const [days, setDays] = useState<WeekDay[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadWeekSeries(Date.now(), todayTotal)
      .then((d) => {
        if (alive) setDays(d);
      })
      .catch(() => {
        if (alive) setDays(null);
      });
    return () => {
      alive = false;
    };
  }, [todayTotal]);
  return days;
}

function WeekChart({ days }: { days: WeekDay[] }) {
  const W = 320;
  const H = 72;
  const pad = 6;
  const max = Math.max(1, ...days.map((d) => d.total));
  const step = (W - pad * 2) / (days.length - 1);
  const pts = days.map((d, i) => ({
    x: pad + i * step,
    y: pad + (H - pad * 2) * (1 - d.total / max),
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`;
  const last = pts[pts.length - 1];
  const label = `Ventas de los últimos 7 días: ${days
    .map((d) => `${d.label} ${formatCop(d.total)}`)
    .join(", ")}`;
  return (
    <div role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[72px] w-full" aria-hidden>
        <path d={area} fill="var(--hero-accent)" fillOpacity={0.12} />
        <path
          d={line}
          fill="none"
          stroke="var(--hero-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="relative -mt-[72px] h-[72px]" aria-hidden>
        <span
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-on-hero"
          style={{ left: `${(last.x / W) * 100}%`, top: `${(last.y / H) * 100}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1" aria-hidden>
        {days.map((d) => (
          <span
            key={d.key}
            className={`truncate text-center text-xs leading-none ${
              d.isToday ? "font-semibold text-on-hero" : "text-on-hero-muted"
            }`}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Cloud() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18z" />
      <path d="m4 4 16 16" />
    </svg>
  );
}

/** Full-bleed hero shell shared by dashboard, skeleton and error states. */
export function InicioHero({ children, busy }: { children: ReactNode; busy?: boolean }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.hero = "on";
    syncThemeColor();
    return () => {
      delete root.dataset.hero;
      syncThemeColor();
    };
  }, []);
  return (
    <section
      className="-mx-4 -mt-4 bg-hero px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] text-on-hero lg:rounded-t-[var(--r-lg)]"
      aria-busy={busy || undefined}
    >
      {children}
    </section>
  );
}

function MetricCell({
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
  tone?: "neutral" | "danger" | "accent";
}) {
  const well =
    tone === "danger"
      ? "bg-danger-soft text-danger"
      : tone === "accent"
        ? "bg-info-soft text-accent"
        : "bg-surface-2 text-ink";
  return (
    <Link href={href} className="flex min-h-[4.5rem] min-w-0 flex-col justify-center gap-1.5 px-3 py-3">
      <span className={`flex size-8 items-center justify-center rounded-[var(--r-sm)] ${well}`}>
        <GlyphIcon name={icon} />
      </span>
      <span className="block truncate text-base font-semibold leading-tight tabular-nums text-ink">
        {value}
      </span>
      <span className="block truncate text-xs text-ink-muted">{label}</span>
    </Link>
  );
}

function SectionHead({ title, href, link }: { title: string; href: string; link: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      <Link href={href} className="text-xs font-semibold text-ink underline underline-offset-2">
        {link}
      </Link>
    </div>
  );
}

export function InicioDashboard({
  snap,
  onLoadDemo,
  toast,
  fromCache = false,
  capturedAt = null,
}: {
  snap: DashboardSnapshot;
  onLoadDemo?: () => void;
  toast: string | null;
  fromCache?: boolean;
  capturedAt?: number | null;
}) {
  const pill = cajaPill(snap);
  const ventas = salesCaption(snap.todaySalesCount);
  const days = useWeekSeries(snap.todaySalesTotal);
  const quick = QUICK_LINKS.map((item) =>
    item.href === "/inventario" && snap.lowStockCount > 0
      ? { ...item, label: "Stock bajo" }
      : item,
  );

  const banner =
    snap.productCount === 0
      ? { href: "/inventario/nuevo", icon: "plus" as const, title: "Agrega tu primer producto", detail: "El catálogo está vacío" }
      : snap.todaySalesCount === 0
        ? { href: "/ventas/nueva", icon: "bag" as const, title: "Registra tu primera venta", detail: "Todavía no hay ventas hoy" }
        : { href: "/ventas/nueva", icon: "bag" as const, title: "Venta rápida", detail: "Abre la caja registradora" };

  return (
    <div className="flex flex-col">
      <InicioHero>
        {fromCache && capturedAt != null ? (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-on-hero-muted">
            <Cloud />
            Sin conexión · actualizado {new Date(capturedAt).toLocaleString("es-CO")}
          </p>
        ) : null}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">
              {snap.greeting}
            </h1>
            {snap.businessLabel ? (
              <p className="mt-1 truncate text-sm text-on-hero-muted">{snap.businessLabel}</p>
            ) : null}
            <p className="mt-0.5 text-xs text-on-hero-muted">{snap.dateLabel}</p>
          </div>
          <Link
            href={pill.href}
            className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--r-pill)] border border-[color-mix(in_srgb,var(--on-hero)_20%,transparent)] bg-[color-mix(in_srgb,var(--on-hero)_12%,transparent)] px-3 text-sm font-semibold"
          >
            {pill.dot ? <span className={`size-2 rounded-full ${pill.dot}`} aria-hidden /> : null}
            {pill.label}
          </Link>
        </header>

        <div className="mt-7" aria-label="Ventas de hoy">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-on-hero-muted">Hoy</p>
            <p className="text-sm text-on-hero-muted">{ventas}</p>
          </div>
          <Link href="/ventas" className="mt-2 block">
            <p className="break-all text-5xl font-semibold leading-none tracking-tight tabular-nums max-[359px]:text-4xl">
              {formatCop(snap.todaySalesTotal)}
            </p>
          </Link>
        </div>

        {days ? (
          <div className="mt-6">
            <WeekChart days={days} />
          </div>
        ) : null}
        <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-[color-mix(in_srgb,var(--on-hero)_20%,transparent)] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-on-hero-muted">
            {days ? "Últimos 7 días" : "Ventas de hoy"}
          </p>
          <p className="text-sm font-semibold tabular-nums">
            {formatCop(days ? weekTotal(days) : snap.todaySalesTotal)}
          </p>
        </div>
        <div className="mt-2 flex items-center justify-end gap-3">
          <Link href="/mas/estadisticas" className="text-xs font-semibold underline underline-offset-2">
            Ver estadísticas
          </Link>
        </div>
      </InicioHero>

      <section className="-mx-4 -mt-6 flex flex-col gap-6 rounded-t-[28px] bg-bg px-4 pb-2 pt-5 shadow-[0_-8px_24px_rgba(0,0,0,.12)]">
        <div
          className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface"
          aria-label="Señales del día"
        >
          <MetricCell
            href="/inventario"
            icon="alert"
            value={String(snap.lowStockCount)}
            label="Stock bajo"
            tone={snap.lowStockCount > 0 ? "danger" : "neutral"}
          />
          <MetricCell href="/inventario" icon="package" value={String(snap.productCount)} label="Productos" />
          <MetricCell
            href="/clientes"
            icon="users"
            value={formatCop(snap.debtTotal)}
            label={
              snap.debtorCount > 0
                ? `Por cobrar · ${snap.debtorCount} ${snap.debtorCount === 1 ? "fiado" : "fiados"}`
                : "Por cobrar"
            }
            tone={snap.debtTotal > 0 ? "accent" : "neutral"}
          />
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Accesos rápidos</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {quick.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-[5.75rem] flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] border border-border bg-surface px-2 py-3 text-center"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/25 text-ink">
                  <GlyphIcon name={item.icon} />
                </span>
                <span className="text-xs font-semibold leading-tight text-ink">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <Link
          href={banner.href}
          className="flex min-h-16 items-center gap-3 rounded-[var(--r-lg)] bg-hero px-3 py-3 text-on-hero"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-hero-accent text-hero">
            <GlyphIcon name={banner.icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-snug">{banner.title}</span>
            <span className="mt-0.5 block text-xs leading-snug text-on-hero-muted">{banner.detail}</span>
          </span>
          <Chevron />
        </Link>

        <section className="flex flex-col gap-2" aria-label="Fiados pendientes">
          <SectionHead title="Fiados pendientes" href="/clientes" link="Ver todos" />
          <div className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface">
            {snap.debtorCount === 0 ? (
              <p className="px-3 py-2.5 text-sm text-ink-muted">Nadie debe…</p>
            ) : (
              <ul className="divide-y divide-border">
                {snap.debtors.map((c) => (
                  <li key={c.id}>
                    <Link href={`/clientes/${c.id}`} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0 truncate font-medium">{c.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone="info">Pendiente</Badge>
                        <span className="text-sm font-semibold tabular-nums text-accent">{formatCop(c.debt)}</span>
                        <Chevron />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2" aria-label="Atención en inventario">
          <SectionHead title="Atención en inventario" href="/inventario" link="Ver inventario" />
          <div className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface">
            {snap.lowStockCount === 0 ? (
              <p className="px-3 py-2.5 text-sm text-ink-muted">Nada en poco stock</p>
            ) : (
              <ul className="divide-y divide-border">
                {snap.lowStock.map((p) => (
                  <li key={p.id}>
                    <Link href={`/inventario/${p.id}`} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="text-xs text-danger">Poco stock · umbral {p.lowStockAt}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums">
                        {p.stock} u.
                        <Chevron />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
  const bar = "rounded bg-[color-mix(in_srgb,var(--on-hero)_15%,transparent)] motion-safe:animate-pulse";
  return (
    <div className="flex flex-col" aria-label="Cargando">
      <InicioHero busy>
        <div className={`h-7 w-40 ${bar}`} />
        <div className={`mt-2 h-4 w-28 ${bar}`} />
        <div className={`mt-7 h-4 w-16 ${bar}`} />
        <div className={`mt-3 h-12 w-44 ${bar}`} />
        <div className={`mt-6 h-[72px] w-full ${bar}`} />
      </InicioHero>
      <div className="-mx-4 -mt-6 flex flex-col gap-6 rounded-t-[28px] bg-bg px-4 pt-5">
        <div className="h-[4.5rem] rounded-[var(--r-lg)] bg-surface-2" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[5.75rem] rounded-[var(--r-lg)] bg-surface-2" />
          ))}
        </div>
      </div>
    </div>
  );
}
