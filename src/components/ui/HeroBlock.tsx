"use client";

import { useEffect, type ReactNode } from "react";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { syncThemeColor } from "@/theme/storage";
import { Cloud, GlyphIcon } from "./icons";

export type HeroSize = "tall" | "medium" | "compact";

export type HeroBlockProps = {
  size?: HeroSize;
  back?: { href: string; label: string };
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Offline band: «Sin conexión · actualizado …» or a custom text when no timestamp exists. */
  offline?: { capturedAt: number } | { text: string } | null;
  busy?: boolean;
  children?: ReactNode;
};

const PAD: Record<HeroSize, string> = {
  tall: "pb-10",
  medium: "pb-10",
  compact: "pb-9",
};

export function offlineBandText(capturedAt: number): string {
  return `Sin conexión · actualizado ${new Date(capturedAt).toLocaleString("es-CO")}`;
}

/** Hero back button (44px, on-hero tint). */
export function HeroBack({ href, label }: { href: string; label: string }) {
  return (
    <OfflineLink
      href={href}
      ariaLabel={label}
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--on-hero)_12%,transparent)] text-on-hero"
    >
      <GlyphIcon name="back" />
    </OfflineLink>
  );
}

/**
 * Full-bleed hero on --hero (generalises Inicio's hero). Marks
 * <html data-hero="on"> so browser theme-color follows --hero.
 * With no title/back/action it renders only children (Inicio layout).
 */
export function HeroBlock({
  size = "tall",
  back,
  title,
  subtitle,
  action,
  offline,
  busy,
  children,
}: HeroBlockProps) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.hero = "on";
    syncThemeColor();
    return () => {
      delete root.dataset.hero;
      syncThemeColor();
    };
  }, []);
  const hasHead = back != null || title != null || action != null;
  return (
    <section
      className={`-mx-4 -mt-4 bg-hero px-4 ${PAD[size]} pt-[max(1rem,env(safe-area-inset-top))] text-on-hero lg:mt-0 lg:rounded-t-[28px] lg:pt-6`}
      aria-busy={busy || undefined}
    >
      {offline ? (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-on-hero-muted">
          <Cloud />
          {"text" in offline ? offline.text : offlineBandText(offline.capturedAt)}
        </p>
      ) : null}
      {hasHead ? (
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {back ? <HeroBack href={back.href} label={back.label} /> : null}
            <div className={`min-w-0 ${back ? "pt-1.5" : ""}`}>
              {title != null ? (
                <h1
                  className={`font-semibold leading-tight tracking-tight ${
                    size === "compact" ? "text-[22px]" : "text-2xl"
                  }`}
                >
                  {title}
                </h1>
              ) : null}
              {subtitle != null ? (
                <p className="mt-1 text-sm text-on-hero-muted">{subtitle}</p>
              ) : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
