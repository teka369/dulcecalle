"use client";

import { ShrinkForm } from "@/components/inventory/ShrinkForm";

export default function RegaloPage() {
  return (
    <ShrinkForm
      title="Regalo"
      reason="regalar"
      cta="Confirmar regalo"
      toast="Regalo registrado"
      showNote
    />
  );
}
