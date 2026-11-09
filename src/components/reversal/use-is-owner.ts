"use client";

import { useEffect, useState } from "react";
import { ownerRole } from "@/data/pwa/customer-allocations";

/** null while unknown / offline: reversal actions stay hidden (W1). */
export function useIsOwner(online: boolean): boolean | null {
  const [owner, setOwner] = useState<boolean | null>(null);
  useEffect(() => {
    if (!online) return;
    let alive = true;
    void ownerRole().then((v) => {
      if (alive && v !== null) setOwner(v);
    });
    return () => {
      alive = false;
    };
  }, [online]);
  return owner;
}
