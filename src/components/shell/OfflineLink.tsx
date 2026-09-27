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

  return (
    <Link href={href} className={className} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
