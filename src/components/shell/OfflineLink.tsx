"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { isOffline } from "@/data/pwa/offline-nav";

type OfflineClick = {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
  preventDefault: () => void;
};

/** Offline primary clicks become document navigations. Online clicks do not. */
export function onOfflineLinkClick(event: OfflineClick, href: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }
  if (isOffline()) {
    event.preventDefault();
    window.location.assign(href);
  }
}

/**
 * Link that degrades to a document navigation while offline, so the
 * Service Worker can serve the prepared document (or /offline) instead
 * of failing an RSC client navigation. Online behavior is unchanged.
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
