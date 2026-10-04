"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { Fab } from "./Fab";
import { AuthGate } from "./AuthGate";
import { EntityViewHost } from "./EntityViewHost";
import { shellHidesChrome, shellHidesFab } from "./shell-chrome";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideChrome = shellHidesChrome(pathname);
  const hideFab = shellHidesFab(pathname);

  // Floating pill + circular action + sync pill above them, plus the home-indicator inset.
  const mainPad = hideChrome
    ? "pb-6 pt-4"
    : "pb-[calc(8.75rem+env(safe-area-inset-bottom))] pt-4";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col overflow-x-hidden bg-bg text-ink">
      <AuthGate>
      <main className={`flex-1 px-4 ${mainPad}`}>
        {children}
      </main>
      <EntityViewHost />
      {!hideChrome && (
        <div className="pointer-events-none fixed inset-x-0 z-40 px-1.5 bottom-[max(0.75rem,env(safe-area-inset-bottom))] min-[380px]:px-3">
          <div className="pointer-events-auto mx-auto flex w-full max-w-lg items-center gap-1.5 min-[380px]:gap-2">
            <BottomNav />
            {!hideFab && <Fab />}
          </div>
        </div>
      )}
      </AuthGate>
    </div>
  );
}
