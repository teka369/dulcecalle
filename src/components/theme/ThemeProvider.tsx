"use client";

import { useLayoutEffect } from "react";
import {
  applyMode,
  applyPalette,
  loadMode,
  loadPalette,
  readCachedMode,
  readCachedPalette,
} from "@/theme/storage";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    applyPalette(readCachedPalette());
    applyMode(readCachedMode());
    void loadPalette().then(applyPalette);
    void loadMode().then(applyMode);
  }, []);
  return children;
}
