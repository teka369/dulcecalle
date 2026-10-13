"use client";

import { ThemeSelector } from "@/components/theme/ThemeSelector";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";

export default function AparienciaPage() {
  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="compact"
        back={{ href: "/mas", label: "Volver a Más" }}
        title="Apariencia"
        subtitle="Se guarda en este teléfono"
      />
      <Sheet>
        <ThemeSelector />
      </Sheet>
    </div>
  );
}
