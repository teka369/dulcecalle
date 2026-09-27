"use client";

import { usePathname } from "next/navigation";
import { OfflineLink } from "./OfflineLink";

const items = [
  { href: "/", label: "Inicio", icon: "home" },
  { href: "/ventas", label: "Ventas", icon: "receipt" },
  { href: "/clientes", label: "Clientes", icon: "users" },
  { href: "/inventario", label: "Inventario", icon: "package" },
  { href: "/mas", label: "Más", icon: "more" },
] as const;

type IconName = (typeof items)[number]["icon"];

function NavIcon({ name }: { name: IconName }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.85,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V20h14V9.5" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...common}>
          <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.25" />
          <path d="M2.5 19c.6-3.2 2.9-5 6.5-5s5.9 1.8 6.5 5" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M16 14c2.4.3 4.2 1.5 4.8 4" />
        </svg>
      );
    case "package":
      return (
        <svg {...common}>
          <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.35" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex h-12 min-w-0 flex-1 items-stretch rounded-full bg-ink px-1 py-1 text-bg shadow-[var(--shadow-lg)] min-[380px]:h-14"
      aria-label="Navegación principal"
    >
      <ul className="flex w-full items-stretch justify-between gap-0.5">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex min-w-0 flex-1">
              <OfflineLink
                href={item.href}
                className={`flex min-h-11 w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-0.5 motion-safe:transition-colors motion-safe:duration-200 ${
                  active ? "bg-bg text-ink" : "text-bg opacity-70"
                }`}
              >
                <NavIcon name={item.icon} />
                <span className="max-w-full truncate text-[clamp(8px,2.6vw,10px)] font-semibold leading-none tracking-tight">
                  {item.label}
                </span>
                <span
                  className={`h-1 w-1 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
                  aria-hidden
                />
              </OfflineLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
