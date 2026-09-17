"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { PayMethod, Product, Supplier } from "@/domain/types";
import {
  INVENTORY_ERRORS,
  INVENTORY_TOASTS,
  validateMotivo,
  validateShrinkQty,
  validateSurtirForm,
  type ShrinkReason,
} from "@/domain/inventory";
import {
  inventoryRepository,
  productRepository,
  supplierRepository,
  type SupplierSurtirHistoryItem,
} from "@/repositories";

type InventoryState = {
  products: Product[];
  suppliers: Supplier[];
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
  async refreshProducts(): Promise<Product[]> {
    setState({ loading: true });
    const products = await productRepository.list();
    setState({ products, loading: false });
    return products;
  },
  async refreshSuppliers(): Promise<Supplier[]> {
    const suppliers = await supplierRepository.list();
    setState({ suppliers });
    return suppliers;
  },
  async refreshAll(): Promise<void> {
    setState({ loading: true });
    const [products, suppliers] = await Promise.all([
      productRepository.list(),
      supplierRepository.list(),
    ]);
    setState({ products, suppliers, loading: false });
  },
  async getProduct(id: number): Promise<Product | undefined> {
    return productRepository.getById(id);
  },
  async getSupplier(id: number): Promise<Supplier | undefined> {
    return supplierRepository.getById(id);
  },
  async listProductMoves(productId: number) {
    return inventoryRepository.listMoves(productId);
  },
  async listSupplierSurtidas(
    supplierId: number,
  ): Promise<SupplierSurtirHistoryItem[]> {
    return supplierRepository.listSurtidas(supplierId);
  },
  async createProduct(input: {
    name: string;
    priceRaw: string;
    stockRaw?: string;
    avgCostRaw?: string;
    gifted?: boolean;
  }): Promise<number> {
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
    const id = await productRepository.create({
      name,
      category: "General",
      price,
      avgCost,
      stock,
      lowStockAt: 5,
      gifted,
    });
    await this.refreshProducts();
    setState({ lastToast: INVENTORY_TOASTS.productSaved });
    return id;
  },
  async createSupplier(input: {
    name: string;
    phone?: string;
    notes?: string;
  }): Promise<number> {
    const id = await supplierRepository.create(input);
    await this.refreshSuppliers();
    setState({ lastToast: INVENTORY_TOASTS.supplierSaved });
    return id;
  },
  /**
   * UI → store → repository → Dexie surtir.
   * Pay method required (Efectivo|Nequi). Mermas do NOT use this.
   */
  async surtir(input: {
    productId: number;
    qtyRaw: string;
    unitCostRaw: string;
    totalCostRaw: string;
    method: PayMethod | null;
    supplierId?: number | null;
    supplierNameCreate?: string;
    note?: string;
    requestId?: string;
  }): Promise<number> {
    const parsed = validateSurtirForm({
      qtyRaw: input.qtyRaw,
      unitCostRaw: input.unitCostRaw,
      totalCostRaw: input.totalCostRaw,
      method: input.method,
    });
    if ("error" in parsed) throw new Error(parsed.error);

    let supplierId = input.supplierId ?? null;
    if (
      (supplierId == null || supplierId <= 0) &&
      input.supplierNameCreate?.trim()
    ) {
      supplierId = await supplierRepository.findOrCreateByName(
        input.supplierNameCreate,
      );
    }

    const moveId = await inventoryRepository.surtir({
      productId: input.productId,
      qty: parsed.qty,
      unitCost: parsed.unitCost,
      totalCost: parsed.totalCost,
      method: parsed.method,
      supplierId,
      note: input.note?.trim() || undefined,
      requestId: input.requestId,
    });
    await this.refreshAll();
    setState({ lastToast: INVENTORY_TOASTS.surtir });
    return moveId;
  },
  async applyShrink(input: {
    productId: number;
    qtyRaw: string;
    reason: ShrinkReason;
    note?: string;
    /** Required when reason === perdido */
    motivoRaw?: string;
    requestId?: string;
  }): Promise<number> {
    const product = await productRepository.getById(input.productId);
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

    const moveId = await inventoryRepository.applyShrink({
      productId: input.productId,
      qty: parsed.qty,
      reason: input.reason,
      note,
      requestId: input.requestId,
    });
    await this.refreshProducts();
    const toast =
      input.reason === "me_lo_comi"
        ? INVENTORY_TOASTS.meLoComi
        : input.reason === "regalar"
          ? INVENTORY_TOASTS.regalo
          : INVENTORY_TOASTS.perdido;
    setState({ lastToast: toast });
    return moveId;
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
    clearToast: inventoryStore.clearToast,
    todayLocalDateInput: inventoryStore.todayLocalDateInput,
  };
}
