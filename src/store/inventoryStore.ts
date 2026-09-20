"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { PayMethod } from "@/domain/types";
import {
  INVENTORY_ERRORS,
  INVENTORY_TOASTS,
  validateMotivo,
  validateShrinkQty,
  validateSurtirForm,
  type ShrinkReason,
} from "@/domain/inventory";
import { ApiError } from "@/data/errors";
import { getPwaApi } from "@/data/pwa/api";
import {
  getCachedProduct,
  getCachedSupplier,
  listCachedProducts,
  listCachedSuppliers,
} from "@/data/pwa/catalog";
import type { RemoteProduct, RemoteStockMove, RemoteSupplier } from "@/data/http/mappers";
import { createSupplierWithOfflineFallback } from "@/data/pwa/offline-catalog";

export type PwaSupplierSurtir = {
  moveId: string;
  createdAt: number;
  productId: string;
  productName: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  method: string | null;
};

type InventoryState = {
  products: RemoteProduct[];
  suppliers: RemoteSupplier[];
  loading: boolean;
  lastToast: string | null;
};

const listeners = new Set<() => void>();

let state: InventoryState = {
  products: [],
  suppliers: [],
  loading: false,
  lastToast: null,
};

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<InventoryState>) {
  state = { ...state, ...patch };
  emit();
}

function fail(e: unknown): never {
  if (e instanceof ApiError) throw new Error(e.message);
  if (e instanceof Error) throw e;
  throw new Error("Algo salió mal.");
}

function todayLocalDateInput(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const inventoryStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): InventoryState {
    return state;
  },
  todayLocalDateInput,
  async refreshProducts(): Promise<RemoteProduct[]> {
    setState({ loading: true });
    try {
      const products = await listCachedProducts();
      setState({ products, loading: false });
      return products;
    } catch (e) {
      setState({ loading: false });
      fail(e);
    }
  },
  async refreshSuppliers(): Promise<RemoteSupplier[]> {
    try {
      const suppliers = await listCachedSuppliers();
      setState({ suppliers });
      return suppliers;
    } catch (e) {
      fail(e);
    }
  },
  async refreshAll(): Promise<void> {
    setState({ loading: true });
    try {
      const [products, suppliers] = await Promise.all([
        listCachedProducts(),
        listCachedSuppliers(),
      ]);
      setState({ products, suppliers, loading: false });
    } catch (e) {
      setState({ loading: false });
      fail(e);
    }
  },
  async getProduct(id: string): Promise<RemoteProduct | undefined> {
    try {
      return await getCachedProduct(id);
    } catch {
      return undefined;
    }
  },
  async getSupplier(id: string): Promise<RemoteSupplier | undefined> {
    try {
      return await getCachedSupplier(id);
    } catch {
      return undefined;
    }
  },
  async listProductMoves(productId: string): Promise<RemoteStockMove[]> {
    return getPwaApi().inventory.moves(productId);
  },
  async listSupplierSurtidas(supplierId: string): Promise<PwaSupplierSurtir[]> {
    const rows = await getPwaApi().suppliers.surtidas(supplierId);
    return rows.map((r) => ({
      ...r,
      createdAt:
        typeof r.createdAt === "number"
          ? r.createdAt
          : Date.parse(String(r.createdAt)),
    }));
  },
  async createProduct(input: {
    name: string;
    priceRaw: string;
    stockRaw?: string;
    avgCostRaw?: string;
    gifted?: boolean;
  }): Promise<string> {
    const name = input.name.trim();
    if (!name) throw new Error(INVENTORY_ERRORS.emptyProductName);
    const price = Number.parseInt(input.priceRaw.trim() || "0", 10);
    if (!Number.isFinite(price) || price < 0 || !Number.isInteger(price)) {
      throw new Error(INVENTORY_ERRORS.badCost);
    }
    const stock = Number.parseInt(input.stockRaw?.trim() || "0", 10);
    if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) {
      throw new Error(INVENTORY_ERRORS.notPositive);
    }
    const gifted = Boolean(input.gifted);
    const avgCost = gifted
      ? 0
      : Number.parseInt(input.avgCostRaw?.trim() || "0", 10) || 0;
    if (stock > 0 && avgCost <= 0 && !gifted) {
      throw new Error(INVENTORY_ERRORS.needCost);
    }
    try {
      const created = await getPwaApi().products.create(
        { name, price, stock, avgCost, lowStockAt: 5, gifted },
        crypto.randomUUID(),
      );
      await this.refreshProducts();
      setState({ lastToast: INVENTORY_TOASTS.productSaved });
      return created.id;
    } catch (e) {
      fail(e);
    }
  },
  async createSupplier(input: {
    name: string;
    phone?: string;
    notes?: string;
  }): Promise<{ id: string; mode: "online" | "offline" }> {
    try {
      const result = await createSupplierWithOfflineFallback(
        input,
        crypto.randomUUID(),
      );
      await this.refreshSuppliers();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Proveedor guardado sin conexión"
            : INVENTORY_TOASTS.supplierSaved,
      });
      return {
        id: result.mode === "offline" ? result.supplierId : result.supplier.id,
        mode: result.mode,
      };
    } catch (e) {
      fail(e);
    }
  },
  async surtir(input: {
    productId: string;
    qtyRaw: string;
    unitCostRaw: string;
    totalCostRaw: string;
    method: PayMethod | null;
    supplierId?: string | null;
    supplierNameCreate?: string;
    note?: string;
    requestId?: string;
  }): Promise<string> {
    const parsed = validateSurtirForm({
      qtyRaw: input.qtyRaw,
      unitCostRaw: input.unitCostRaw,
      totalCostRaw: input.totalCostRaw,
      method: input.method,
    });
    if ("error" in parsed) throw new Error(parsed.error);

    let supplierId = input.supplierId ?? null;
    if (!supplierId && input.supplierNameCreate?.trim()) {
      const created = await getPwaApi().suppliers.create(
        {
          name: input.supplierNameCreate.trim(),
        },
        crypto.randomUUID(),
      );
      supplierId = created.id;
    }

    try {
      const move = await getPwaApi().inventory.surtir(
        input.productId,
        {
          qty: parsed.qty,
          unitCost: parsed.unitCost,
          totalCost: parsed.totalCost,
          method: parsed.method,
          supplierId,
          note: input.note?.trim() || undefined,
        },
        input.requestId ?? crypto.randomUUID(),
      );
      await this.refreshAll();
      setState({ lastToast: INVENTORY_TOASTS.surtir });
      return move.id;
    } catch (e) {
      fail(e);
    }
  },
  async applyShrink(input: {
    productId: string;
    qtyRaw: string;
    reason: ShrinkReason;
    note?: string;
    motivoRaw?: string;
    requestId?: string;
  }): Promise<string> {
    const product = await this.getProduct(input.productId);
    if (!product) throw new Error("product not found");

    const parsed = validateShrinkQty(input.qtyRaw, product.stock);
    if ("error" in parsed) throw new Error(parsed.error);

    if (input.reason === "perdido") {
      const motivoErr = validateMotivo(input.motivoRaw ?? "");
      if (motivoErr) throw new Error(motivoErr);
    }

    const note =
      input.reason === "perdido"
        ? (input.motivoRaw ?? "").trim()
        : input.note?.trim() || undefined;

    try {
      const move = await getPwaApi().inventory.shrink(
        input.productId,
        { qty: parsed.qty, reason: input.reason, note },
        input.requestId ?? crypto.randomUUID(),
      );
      await this.refreshProducts();
      const toast =
        input.reason === "me_lo_comi"
          ? INVENTORY_TOASTS.meLoComi
          : input.reason === "regalar"
            ? INVENTORY_TOASTS.regalo
            : INVENTORY_TOASTS.perdido;
      setState({ lastToast: toast });
      return move.id;
    } catch (e) {
      fail(e);
    }
  },
  clearToast() {
    setState({ lastToast: null });
  },
};

export function useInventory() {
  const snap = useSyncExternalStore(
    inventoryStore.subscribe,
    inventoryStore.getSnapshot,
    inventoryStore.getSnapshot,
  );

  const refreshAll = useCallback(() => inventoryStore.refreshAll(), []);
  const refreshProducts = useCallback(
    () => inventoryStore.refreshProducts(),
    [],
  );
  const refreshSuppliers = useCallback(
    () => inventoryStore.refreshSuppliers(),
    [],
  );

  return {
    ...snap,
    refreshAll,
    refreshProducts,
    refreshSuppliers,
    getProduct: inventoryStore.getProduct,
    getSupplier: inventoryStore.getSupplier,
    listProductMoves: inventoryStore.listProductMoves,
    listSupplierSurtidas: inventoryStore.listSupplierSurtidas,
    createProduct: inventoryStore.createProduct.bind(inventoryStore),
    createSupplier: inventoryStore.createSupplier.bind(inventoryStore),
    surtir: inventoryStore.surtir.bind(inventoryStore),
    applyShrink: inventoryStore.applyShrink.bind(inventoryStore),
    todayLocalDateInput: inventoryStore.todayLocalDateInput,
    clearToast: inventoryStore.clearToast,
  };
}
