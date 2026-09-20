"use client";

import { useEffect } from "react";
import { startSalesSync } from "@/data/pwa/offline-sales";
import { startPaymentsSync } from "@/data/pwa/offline-payments";
import { startCatalogCreationSync } from "@/data/pwa/offline-catalog";

export function SalesSyncBridge() {
  useEffect(() => {
    const stopSales = startSalesSync();
    const stopPayments = startPaymentsSync();
    const stopCatalog = startCatalogCreationSync();
    return () => {
      stopSales();
      stopPayments();
      stopCatalog();
    };
  }, []);
  return null;
}
