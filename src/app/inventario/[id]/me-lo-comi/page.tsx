"use client";

import { ShrinkForm } from "@/components/inventory/ShrinkForm";

export default function MeLoComiPage() {
  return (
    <ShrinkForm
      title="Me lo comí"
      reason="me_lo_comi"
      cta="Confirmar"
      toast="Listo, descontado del stock"
    />
  );
}
