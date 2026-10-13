import type { ReactNode } from "react";

/** Continuous sheet overlapping the hero by 24px (Inicio language). */
export function Sheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`-mx-4 -mt-6 flex flex-col gap-6 rounded-t-[28px] bg-bg px-4 pb-2 pt-5 shadow-[0_-8px_24px_rgba(0,0,0,.12)] ${className}`.trim()}
    >
      {children}
    </section>
  );
}
