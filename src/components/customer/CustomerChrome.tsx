"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getCustomerApi } from "@/data/http/customer-api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const links = [
  { href: "/cliente", label: "Inicio" },
  { href: "/cliente/cuenta", label: "Cuenta" },
  { href: "/cliente/compras", label: "Compras" },
  { href: "/cliente/pagos", label: "Pagos" },
  { href: "/cliente/productos", label: "Productos" },
  { href: "/cliente/perfil", label: "Perfil" },
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
      <div className="flex items-center gap-2">
        <Image
          src="/brand/dulcecalle-logo.png"
          alt="Dulce Calle"
          width={32}
          height={32}
          className="h-8 w-8 rounded-[var(--r-md)] object-contain"
        />
        <span className="text-sm font-semibold text-ink-muted">Dulce Calle</span>
      </div>
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
              className={`inline-flex h-11 min-h-11 items-center justify-center rounded-[var(--r-md)] px-4 text-sm font-semibold transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                active
                  ? "bg-cta text-cta-fg hover:opacity-[0.92]"
                  : "border border-border bg-surface text-ink hover:opacity-[0.92]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          onClick={() => void onLogout()}
        >
          Salir
        </Button>
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
    <Card className="py-3">
      <p className="text-sm font-semibold">
        Sin conexión · Mostrando datos de la última consulta
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Última consulta: {when}. No es el saldo en tiempo real.
      </p>
    </Card>
  );
}
