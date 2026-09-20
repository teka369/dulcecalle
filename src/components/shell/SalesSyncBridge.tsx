"use client";

import { useEffect } from "react";
import { startSalesSync } from "@/data/pwa/offline-sales";
import { startPaymentsSync } from "@/data/pwa/offline-payments";
import { startCatalogCreationSync } from "@/data/pwa/offline-catalog";
import { startOperationsSync } from "@/data/pwa/offline-operations";

export function SalesSyncBridge() {
  useEffect(() => {
    const stopSales = startSalesSync();
    const stopPayments = startPaymentsSync();
    const stopCatalog = startCatalogCreationSync();
    const stopOperations = startOperationsSync();
    return () => {
      stopSales();
      stopPayments();
      stopCatalog();
      stopOperations();
    };
  }, []);
  return null;
}
