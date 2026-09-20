import Link from "next/link";
import { formatCop } from "@/domain/money";
import { formatBogotaDateTime } from "@/domain/debt/statement";
import { CASH_COPY } from "@/domain/cash";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";

function MetricCard({
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
    <article className="rounded-2xl border border-ink/[0.08] bg-surface p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink/50">
        {label}
      </p>
      <p
        className={`mt-1 break-all text-base font-semibold leading-tight tabular-nums ${toneClass}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs leading-snug text-ink/55">{caption}</p>
    </article>
  );
  if (href) {
    return (
      <Link href={href} className="block min-w-0">
        {body}
      </Link>
    );
  }
  return body;
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
  const salesCaption =
    snap.todaySalesCount === 0
      ? "Sin ventas registradas hoy"
      : `${snap.todaySalesCount} ${snap.todaySalesCount === 1 ? "venta" : "ventas"}`;
  const debtCaption =
    snap.debtorCount === 0
      ? "Nadie debe…"
      : `${snap.debtorCount} ${snap.debtorCount === 1 ? "cliente" : "clientes"}`;
  const stockCaption =
    snap.productCount === 0
      ? "Sin productos en catálogo"
      : snap.lowStockCount === 0
        ? "Nada en poco stock"
        : `${snap.lowStockCount} con poco stock`;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-ink/60">{snap.greeting}</p>
          <p className="min-w-0 text-right text-xs leading-tight text-ink/45">
            {snap.dateLabel}
          </p>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">
          Resumen de hoy
        </h1>
        {snap.businessLabel ? (
          <p className="text-xs text-ink/45">{snap.businessLabel}</p>
        ) : null}
      </header>

      <section className="grid grid-cols-2 gap-2">
        <MetricCard
          label="Ventas de hoy"
          value={formatCop(snap.todaySalesTotal)}
          caption={salesCaption}
        />
        <MetricCard
          label="Por cobrar"
          value={formatCop(snap.debtTotal)}
          caption={debtCaption}
          tone={snap.debtTotal > 0 ? "accent" : "ink"}
          href="/clientes"
        />
        <MetricCard
          label="Caja"
          value={caja.value}
          caption={caja.caption}
          tone={caja.tone}
          href="/mas/caja"
        />
        <MetricCard
          label="Inventario"
          value={String(snap.productCount)}
          caption={stockCaption}
          tone={snap.lowStockCount > 0 ? "danger" : "ink"}
          href="/inventario"
        />
      </section>

      <section>
        <div className="grid grid-cols-2 gap-2">
          {snap.actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={`flex min-h-11 items-center justify-center rounded-[14px] px-3 text-center text-sm font-semibold ${
                action.primary
                  ? "bg-cta text-white"
                  : "border border-ink/10 bg-surface"
              }`}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink/70">Fiados pendientes</h2>
          <Link href="/clientes" className="text-xs font-semibold text-cta underline underline-offset-2">
            Ver todos
          </Link>
        </div>
        {snap.debtorCount === 0 ? (
          <p className="rounded-2xl border border-ink/[0.08] bg-surface px-3 py-2.5 text-sm text-ink/60">
            Nadie debe…
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snap.debtors.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clientes/${c.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-ink/[0.08] bg-surface px-3 py-2.5"
                >
                  <span className="min-w-0 truncate font-medium">{c.name}</span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="text-sm font-semibold tabular-nums text-accent">
                      {formatCop(c.debt)}
                    </span>
                    <span className="text-[11px] font-medium text-accent/80">
                      Pendiente
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink/70">
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
          <p className="rounded-2xl border border-ink/[0.08] bg-surface px-3 py-2.5 text-sm text-ink/60">
            Nada en poco stock
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snap.lowStock.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/inventario/${p.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-ink/[0.08] bg-surface px-3 py-2.5"
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

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink/70">Actividad reciente</h2>
        {snap.activity.length === 0 ? (
          <p className="rounded-2xl border border-ink/[0.08] bg-surface px-3 py-2.5 text-sm text-ink/60">
            Todavía no hay actividad registrada.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snap.activity.map((row) => (
              <li key={row.id}>
                <Link
                  href={row.href ?? "/"}
                  className="flex min-h-11 items-start justify-between gap-3 rounded-2xl border border-ink/[0.08] bg-surface px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{row.title}</span>
                    {row.detail ? (
                      <span className="block truncate text-xs text-ink/60">
                        {row.detail}
                      </span>
                    ) : null}
                    <span className="block text-xs text-ink/45">
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

      {snap.emptyDb && (
        onLoadDemo ? (
          <button
            type="button"
            onClick={onLoadDemo}
            className="min-h-11 rounded-[14px] bg-primary px-4 text-sm font-semibold text-ink"
          >
            Cargar demo
          </button>
        ) : (
          <Link
            href="/inventario/nuevo"
            className="flex min-h-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
          >
            Agregar el primer producto
          </Link>
        )
      )}

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
        <div className="h-4 w-28 rounded bg-ink/10" />
        <div className="mt-2 h-6 w-40 rounded bg-ink/10" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[5.25rem] rounded-2xl border border-ink/[0.08] bg-surface"
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`a-${i}`}
            className="h-11 rounded-[14px] border border-ink/10 bg-surface"
          />
        ))}
      </div>
    </div>
  );
}
