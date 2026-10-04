"use client";

import { createContext, useContext } from "react";
import { useParams } from "next/navigation";
import { routeId } from "@/data/pwa/ids";

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
