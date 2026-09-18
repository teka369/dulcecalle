"use client";

import { useLayoutEffect } from "react";
import { applyPalette, loadPalette, readCachedPalette } from "@/theme/storage";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    applyPalette(readCachedPalette());
    void loadPalette().then(applyPalette);
  }, []);
  return children;
}
