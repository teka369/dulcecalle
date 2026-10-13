"use client";

import { useRouter } from "next/navigation";
import { NOT_A_BACKUP } from "@/data/pwa/sync-copy";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { Cloud } from "@/components/ui/icons";

export default function OfflinePage() {
  const router = useRouter();
  return (
    <div className="flex flex-col">
      <HeroBlock
        size="tall"
        title={
          <span className="flex items-center gap-2">
            <span className="[&_svg]:size-7"><Cloud /></span>
            Sin conexión
          </span>
        }
        subtitle="Puedes seguir trabajando. Lo que guardes queda en este teléfono y se enviará cuando vuelva la conexión."
      >
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-5 inline-flex min-h-12 items-center justify-center rounded-[var(--r-pill)] bg-on-hero px-5 text-base font-semibold text-hero"
        >
          Volver al inicio
        </button>
      </HeroBlock>
      <Sheet>
        <p className="text-base leading-snug text-ink">No se ha perdido. Tampoco está todavía en el servidor.</p>
        <p className="text-sm leading-snug text-ink-muted">
          Para trabajar sin conexión, abre Dulce Calle desde el inicio y navega desde las secciones preparadas. Una ficha abierta directo, que nunca cargaste, no está disponible sin internet.
        </p>
        <p className="text-sm leading-snug text-ink-muted">{NOT_A_BACKUP}</p>
      </Sheet>
    </div>
  );
}
