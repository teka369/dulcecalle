"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { isOffline } from "@/data/pwa/offline-nav";

/**
 * Link that degrades to a document navigation while offline, so the
 * Service Worker can serve the prepared document (or /offline) instead
 * of failing an RSC client navigation. Online behavior is unchanged.
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
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (isOffline()) {
      e.preventDefault();
      window.location.assign(href);
    }
  }

  return (
    <Link href={href} className={className} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
