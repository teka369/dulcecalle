"use client";

import { usePathname } from "next/navigation";
import { OfflineLink } from "./OfflineLink";

const items = [
  { href: "/", label: "Inicio" },
  { href: "/ventas", label: "Ventas" },
  { href: "/clientes", label: "Clientes" },
  { href: "/inventario", label: "Inventario" },
  { href: "/mas", label: "Más" },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-ink/10 bg-bg/95 backdrop-blur"
      aria-label="Navegación principal"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-1">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <OfflineLink
                href={item.href}
                className={`flex min-h-11 flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs font-medium ${
                  active ? "text-ink" : "text-ink/55"
                }`}
              >
                <span
                  className={`h-1 w-1 rounded-full ${active ? "bg-cta" : "bg-transparent"}`}
                />
                {item.label}
              </OfflineLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
