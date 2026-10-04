"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { isOffline } from "@/data/pwa/offline-nav";
import { parseEntityHref } from "@/data/pwa/entity-href";
import { entityViewStore } from "@/store/entityViewStore";

type OfflineClick = {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
  preventDefault: () => void;
};

/** Offline static clicks become document navigations. Entity fichas stay in the shell. */
export function onOfflineLinkClick(event: OfflineClick, href: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }
  if (!isOffline()) return;
  event.preventDefault();
  if (parseEntityHref(href)) {
    entityViewStore.open(href);
    return;
  }
  window.location.assign(href);
}

/**
 * Link that stays a normal Next navigation while online. Offline, a
 * prepared static route becomes a document navigation. An entity ficha
 * opens inside the already-loaded shell and reads IndexedDB — it does
 * not request a new HTML or RSC payload.
 * Visual: inherits className; adds DS focus ring when not overridden.
 */
export function OfflineLink({
  href,
  className,
  children,
  ariaLabel,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    onOfflineLinkClick(e, href);
  }

  const focus =
    "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]";
  const merged = className ? `${focus} ${className}` : focus;

  return (
    <Link href={href} className={merged} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
