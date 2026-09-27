"use client";

import { useLayoutEffect } from "react";
import { applyPalette, loadPalette, readCachedPalette } from "@/theme/storage";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!root.dataset.mode) {
      root.dataset.mode = "light";
    }
    applyPalette(readCachedPalette());
    void loadPalette().then(applyPalette);
  }, []);
  return children;
}
