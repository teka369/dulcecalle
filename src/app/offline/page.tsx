"use client";

import { useRouter } from "next/navigation";
import { NOT_A_BACKUP } from "@/data/pwa/sync-copy";
import { Button } from "@/components/ui/Button";

export default function OfflinePage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-3 py-8">
      <h1 className="text-[22px] font-semibold tracking-tight">Sin conexión</h1>
      <p className="text-base leading-snug text-ink-muted">
        Puedes seguir trabajando. Lo que guardes queda en este teléfono y se
        enviará cuando vuelva la conexión.
      </p>
      <p className="text-base leading-snug">
        No se ha perdido. Tampoco está todavía en el servidor.
      </p>
      <p className="text-sm leading-snug text-ink-muted">
        Para trabajar sin conexión, abre Dulce Calle desde el inicio y navega desde las secciones preparadas. Una ficha abierta directo, que nunca cargaste, no está disponible sin internet.
      </p>
      <p className="text-sm leading-snug text-ink-muted">{NOT_A_BACKUP}</p>
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
