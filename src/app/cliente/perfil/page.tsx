"use client";

import { useEffect, useState } from "react";
import { CustomerChrome } from "@/components/customer/CustomerChrome";
import { ThemeSelector } from "@/components/theme/ThemeSelector";
import { getCustomerAuthSession } from "@/data/http/customer-session";
import type { CustomerProfile } from "@/data/http/customer-session";

export default function CustomerProfilePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);

  useEffect(() => {
    setProfile(getCustomerAuthSession().customer);
  }, []);

  return (
    <CustomerChrome
      title="Mi perfil"
      size="compact"
      subtitle={[profile?.name ?? "Cliente", profile?.code ? `Código ${profile.code}` : null].filter(Boolean).join(" · ")}
    >
      <ThemeSelector />
      <p className="text-xs leading-relaxed text-ink-muted">
        El tema se guarda en este teléfono y funciona sin conexión. No cambia tus datos ni tu saldo.
      </p>
    </CustomerChrome>
  );
}
