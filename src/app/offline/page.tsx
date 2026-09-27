"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export default function OfflinePage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-3 py-8">
      <h1 className="text-[22px] font-semibold tracking-tight">Sin conexión</h1>
      <p className="text-base text-ink-muted">
        No hay red. Tus datos locales siguen en el dispositivo; vuelve a intentar
        cuando tengas internet.
      </p>
      <Button
        type="button"
        variant="primary"
        className="mt-2 w-fit"
        onClick={() => router.push("/")}
      >
        Reintentar
      </Button>
    </div>
  );
}
