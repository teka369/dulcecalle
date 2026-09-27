import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="flex flex-col gap-3 py-8">
      <h1 className="text-[22px] font-semibold tracking-tight">Sin conexión</h1>
      <p className="text-base text-ink-muted">
        No hay red. Tus datos locales siguen en el dispositivo; vuelve a intentar
        cuando tengas internet.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex min-h-11 w-fit items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
      >
        Reintentar
      </Link>
    </div>
  );
}
