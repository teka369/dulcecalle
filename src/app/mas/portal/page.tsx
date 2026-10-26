"use client";

import { useEffect, useState } from "react";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { getPwaAuthSession } from "@/data/http/session";
import { portalLink, storeCode } from "@/domain/store-code";

/** Ajustes → Portal de clientes: store code + the link that opens the portal on this store. */
export default function PortalAjustesPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setBusinessId(getPwaAuthSession().businessId);
    setOrigin(window.location.origin);
    setCanShare(typeof navigator.share === "function");
  }, []);

  const link = businessId && origin ? portalLink(origin, businessId) : null;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Enlace copiado");
    } catch {
      setNotice("No se pudo copiar. Mantén presionado el enlace para copiarlo.");
    }
  }

  async function share() {
    if (!link) return;
    try {
      await navigator.share({ title: "Dulce Calle", text: "Consulta tu saldo en la tienda", url: link });
    } catch {
      /* cancelled by the user */
    }
  }

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="compact"
        back={{ href: "/mas", label: "Volver a Más" }}
        title="Portal de clientes"
        subtitle="Para que tus clientes consulten su saldo"
      />
      <Sheet>
        {!businessId ? (
          <p className="text-sm text-ink-muted">Entra con tu cuenta para ver el enlace de tu tienda.</p>
        ) : (
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">Código de la tienda</h2>
              <p data-testid="store-code" className="font-mono text-2xl font-semibold tracking-wider">
                {storeCode(businessId)}
              </p>
              <p className="text-sm text-ink-muted">
                Si un cliente compra en más de una tienda, el portal le pide este código.
              </p>
            </section>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Enlace del portal</h2>
              <p data-testid="portal-link" className="break-all rounded-[var(--r-md)] bg-surface-2 p-3 text-sm">
                {link}
              </p>
              <p className="text-sm text-ink-muted">Con este enlace el cliente entra directo a tu tienda.</p>
              <Button type="button" variant="primary" className="min-h-12 w-full" onClick={() => void copy()}>
                Copiar enlace
              </Button>
              {canShare && (
                <Button type="button" variant="secondary" className="w-full" onClick={() => void share()}>
                  Compartir
                </Button>
              )}
              {notice && (
                <p role="status" className="text-sm text-ink-muted">
                  {notice}
                </p>
              )}
            </section>
          </div>
        )}
      </Sheet>
    </div>
  );
}
