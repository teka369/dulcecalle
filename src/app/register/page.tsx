"use client";

import Link from "next/link";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";

export default function RegisterPage() {
  return (
    <div className="flex flex-col">
      <HeroBlock size="tall" title="Crear cuenta" subtitle="Nombre, correo y contraseña. Nada más." />
      <Sheet>
        <RegisterForm />
        <Link href="/login" className="flex min-h-11 items-center justify-center text-sm font-semibold text-ink">
          Ya tengo cuenta
        </Link>
      </Sheet>
    </div>
  );
}
