"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { routeId } from "@/data/pwa/ids";
import { parseEntityHref } from "@/data/pwa/entity-href";
import { entityViewStore } from "@/store/entityViewStore";

const EntityIdContext = createContext<string | null>(null);

export function EntityIdProvider({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return <EntityIdContext.Provider value={id}>{children}</EntityIdContext.Provider>;
}

/** Route id from the in-shell ficha when present, otherwise from the URL. */
export function useEntityId(): string | null {
  const overlay = useContext(EntityIdContext);
  const params = useParams();
  if (overlay) return routeId(overlay);
  return routeId(params.id);
}

export function useInEntityOverlay(): boolean {
  return useContext(EntityIdContext) != null;
}

/** Overlay back never requests a document. A list target closes the ficha; an entity target pops one level. */
export function entityBackAction(inOverlay: boolean, href: string): "navigate" | "close" | "back" {
  if (!inOverlay) return "navigate";
  return parseEntityHref(href) ? "back" : "close";
}

export function EntityBackLink({
  href,
  className,
  children,
  ariaLabel,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const inOverlay = useInEntityOverlay();
  const action = entityBackAction(inOverlay, href);
  if (action === "navigate") {
    return (
      <Link href={href} className={className} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onClick={() => {
        if (action === "back") entityViewStore.back();
        else entityViewStore.close();
      }}
    >
      {children}
    </button>
  );
}

