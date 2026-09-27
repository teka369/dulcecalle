"use client";

import { useEffect, useState } from "react";
import { CustomerChrome } from "@/components/customer/CustomerChrome";
import { ThemeSelector } from "@/components/theme/ThemeSelector";
import { getCustomerAuthSession } from "@/data/http/customer-session";
import type { CustomerProfile } from "@/data/http/customer-session";
import { Card } from "@/components/ui/Card";

export default function CustomerProfilePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);

  useEffect(() => {
    setProfile(getCustomerAuthSession().customer);
  }, []);

  return (
    <CustomerChrome title="Mi perfil">
      <Card as="section">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Cliente
        </p>
        <p className="mt-1 text-base font-semibold">
          {profile?.name ?? "Cliente"}
        </p>
        {profile?.code && (
          <p className="mt-1 text-sm text-ink-muted">Código {profile.code}</p>
        )}
      </Card>

      <ThemeSelector />

      <p className="text-xs leading-relaxed text-ink-muted">
        El tema se guarda en este teléfono y funciona sin conexión. No cambia
        tus datos ni tu saldo.
      </p>
    </CustomerChrome>
  );
}
