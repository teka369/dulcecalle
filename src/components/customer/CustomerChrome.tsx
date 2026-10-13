"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getCustomerApi } from "@/data/http/customer-api";
import { Card } from "@/components/ui/Card";
import { HeroBlock, type HeroSize } from "@/components/ui/HeroBlock";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { PORTAL_TABS, activePortalTab } from "./portal";

/** Portal tabs: scrollable on-hero links, aria-current on the active one. */
function PortalTabs() {
  const active = activePortalTab(usePathname());
  return (
    <nav aria-label="Consulta" className="mt-5">
      <ul className="flex gap-1 overflow-x-auto rounded-[var(--r-pill)] bg-[color-mix(in_srgb,var(--on-hero)_12%,transparent)] p-1">
        {PORTAL_TABS.map((t) => {
          const on = t.href === active;
          return (
            <li key={t.href} className="shrink-0">
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-11 items-center whitespace-nowrap rounded-[var(--r-pill)] px-3 text-sm font-semibold ${
                  on ? "bg-nav-active-bg text-nav-active-ink" : "text-on-hero"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function CustomerChrome({
  children,
  title,
  subtitle,
  hero,
  size = "medium",
  capturedAt,
  back,
}: {
  children?: ReactNode;
  title?: string;
  subtitle?: ReactNode;
  /** Big content inside the hero (amounts, gallery…). */
  hero?: ReactNode;
  size?: HeroSize;
  /** When set, the hero shows the offline band (cached snapshot). */
  capturedAt?: number | null;
  back?: { href: string; label: string };
}) {
  const router = useRouter();

  async function onLogout() {
    try {
      await getCustomerApi().logout();
    } catch {
      /* local clear still happens in api */
    }
    router.replace("/cliente/login");
  }

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size={size}
        back={back}
        title={
          <span className="flex items-center gap-2">
            <Image
              src="/brand/dulcecalle-logo.png"
              alt="Dulce Calle"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-[var(--r-md)] object-contain"
            />
            <span className="min-w-0">{title ?? "Dulce Calle"}</span>
          </span>
        }
        subtitle={subtitle}
        offline={capturedAt != null ? { text: offlineText(capturedAt) } : null}
        action={<HeroPill label="Salir" onClick={() => void onLogout()} />}
      >
        {hero}
        <PortalTabs />
      </HeroBlock>
      <Sheet>{children}</Sheet>
    </div>
  );
}

function offlineText(capturedAt: number): string {
  const at = new Date(capturedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Sin conexión · Última consulta ${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}. No es el saldo en tiempo real.`;
}

/** Shared loading / error bodies for portal pages. */
export function PortalLoading() {
  return (
    <div aria-busy="true">
      <p className="sr-only">Cargando…</p>
      <SkeletonRows rows={3} />
    </div>
  );
}

export function PortalError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <StateBlock
      kind="error"
      title={message}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
          >
            Reintentar
          </button>
        ) : undefined
      }
    />
  );
}

/** M6.10 — kept for compatibility; pages now use the hero offline band (capturedAt). */
export function CustomerCacheNotice({ capturedAt }: { capturedAt: number }) {
  return (
    <Card className="py-3">
      <p className="text-sm font-semibold">Sin conexión · Mostrando datos de la última consulta</p>
      <p className="mt-1 text-sm text-ink-muted">{offlineText(capturedAt)}</p>
    </Card>
  );
}
