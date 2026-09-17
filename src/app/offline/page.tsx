import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="flex flex-col gap-3 py-8">
      <h1 className="text-[22px] font-semibold tracking-tight">Sin conexión</h1>
      <p className="text-base text-ink/80">
        No hay red. Tus datos locales siguen en el dispositivo; vuelve a intentar
        cuando tengas internet.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex w-fit rounded-xl bg-cta px-4 py-2 text-sm font-medium text-white"
      >
        Reintentar
      </Link>
    </div>
  );
}
