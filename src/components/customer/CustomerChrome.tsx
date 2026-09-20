"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getCustomerApi } from "@/data/http/customer-api";

const links = [
  { href: "/cliente", label: "Inicio" },
  { href: "/cliente/cuenta", label: "Cuenta" },
  { href: "/cliente/compras", label: "Compras" },
  { href: "/cliente/pagos", label: "Pagos" },
] as const;

export function CustomerChrome({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function onLogout() {
    try {
      await getCustomerApi().logout();
    } catch {
      /* local clear still happens in api */
    }
    router.replace("/cliente/login");
  }

  return (
    <div className="flex flex-col gap-4">
      {title && (
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
      )}
      <nav aria-label="Consulta" className="flex flex-wrap gap-2">
        {links.map((item) => {
          const active =
            item.href === "/cliente"
              ? pathname === "/cliente"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-11 items-center rounded-[14px] px-3 text-sm font-semibold ${
                active
                  ? "bg-cta text-white"
                  : "border border-ink/10 bg-surface text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => void onLogout()}
          className="flex min-h-11 items-center rounded-[14px] border border-ink/10 bg-surface px-3 text-sm font-semibold"
        >
          Salir
        </button>
      </nav>
      {children}
    </div>
  );
}

/** M6.10 — Shown when the portal renders a cached ledger instead of live data. */
export function CustomerCacheNotice({ capturedAt }: { capturedAt: number }) {
  const at = new Date(capturedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return (
    <div className="rounded-2xl border border-ink/10 bg-surface px-4 py-3 text-sm">
      <p className="font-semibold">
        Sin conexión · Mostrando datos de la última consulta
      </p>
      <p className="mt-1 text-ink/60">
        Última consulta: {when}. No es el saldo en tiempo real.
      </p>
    </div>
  );
}
