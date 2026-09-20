"use client";

import { useEffect } from "react";
import { startSalesSync } from "@/data/pwa/offline-sales";
import { startPaymentsSync } from "@/data/pwa/offline-payments";

export function SalesSyncBridge() {
  useEffect(() => {
    const stopSales = startSalesSync();
    const stopPayments = startPaymentsSync();
    return () => {
      stopSales();
      stopPayments();
    };
  }, []);
  return null;
}
