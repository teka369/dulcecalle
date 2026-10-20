"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerLedger } from "@/data/http/customer-api";
import { getCustomerAuthSession } from "@/data/http/customer-session";
import { loadCachedCustomerLedger } from "@/data/pwa/customer-ledger-cache";
import { browserOnline, ownLedger, portalErrorMessage } from "./portal";

/** Loads the signed-in customer's ledger (server, else own cache) and guards ownership. */
export function usePortalLedger() {
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    void loadCachedCustomerLedger()
      .then((result) => {
        const mine = ownLedger(result.ledger, getCustomerAuthSession().customer?.id);
        if (!mine) {
          setError("No se pudo cargar.");
          return;
        }
        setLedger(mine);
        setCapturedAt(result.capturedAt);
        setFromCache(result.source === "cache");
      })
      .catch((e: unknown) => {
        setError(portalErrorMessage(e, browserOnline()));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ledger, capturedAt, fromCache, error, reload: load };
}
