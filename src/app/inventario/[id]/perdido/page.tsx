"use client";

import { ShrinkForm } from "@/components/inventory/ShrinkForm";

export default function PerdidoPage() {
  return (
    <ShrinkForm
      title="Perdido / dañado"
      reason="perdido"
      cta="Confirmar perdido"
      toast="Pérdida registrada"
      requireMotivo
    />
  );
}
