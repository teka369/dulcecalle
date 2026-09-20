"use client";

import { useEffect } from "react";
import { startSalesSync } from "@/data/pwa/offline-sales";

export function SalesSyncBridge() {
  useEffect(() => startSalesSync(), []);
  return null;
}
