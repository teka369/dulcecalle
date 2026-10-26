"use client";

import { useEffect } from "react";

/**
 * «Corregir» from the sync center opens a form with `?monto=` / `?cantidad=`
 * / `?categoria=`. Read once on mount; only positive integers (or plain text
 * for categoria) are applied. No param → nothing happens.
 */
export function usePrefill(param: string, apply: (value: string) => void, kind: "int" | "text" = "int"): void {
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get(param)?.trim();
    if (!raw) return;
    if (kind === "int" && !/^[1-9]\d{0,11}$/.test(raw)) return;
    apply(kind === "text" ? raw.slice(0, 60) : raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
