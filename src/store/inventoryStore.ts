"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { PayMethod } from "@/domain/types";
import {
  INVENTORY_ERRORS,
  INVENTORY_TOASTS,
  validateMotivo,
  validatePreparationForm,
  validateShrinkQty,
  validateSurtirForm,
  type ShrinkReason,
} from "@/domain/inventory";
import { ApiError } from "@/data/errors";
import { getPwaApi } from "@/data/pwa/api";
import {
  listPreparationsWithOfflineFallback,
  prepararWithOfflineFallback,
} from "@/data/pwa/offline-production";
import {
  getCachedProduct,
  getCachedSupplier,
  listCachedProducts,
  listCachedSuppliers,
} from "@/data/pwa/catalog";
import type { RemotePreparation, RemoteProduct, RemoteStockMove, RemoteSupplier } from "@/data/http/mappers";
import {
  archiveProductWithOfflineFallback,
  createProductWithOfflineFallback,
  createSupplierWithOfflineFallback,
  patchProductWithOfflineFallback,
  patchSupplierWithOfflineFallback,
} from "@/data/pwa/offline-catalog";
import {
  listLocalStockMoves,
  listLocalSurtidas,
  shrinkWithOfflineFallback,
  surtirWithOfflineFallback,
} from "@/data/pwa/offline-operations";
import { NetworkError } from "@/data/errors";

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
    try {
      return await getPwaApi().inventory.moves(productId);
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      return listLocalStockMoves(productId);
    }
  },
  async listSupplierSurtidas(supplierId: string): Promise<PwaSupplierSurtir[]> {
    try {
      return await this.listSupplierSurtidasOnline(supplierId);
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      return listLocalSurtidas(supplierId);
    }
  },
  async listSupplierSurtidasOnline(supplierId: string): Promise<PwaSupplierSurtir[]> {
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
    sellable?: boolean;
  }): Promise<{ id: string; mode: "online" | "offline" }> {
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
      const result = await createProductWithOfflineFallback(
        {
          name,
          price,
          stock,
          avgCost,
          lowStockAt: 5,
          gifted,
          sellable: input.sellable,
        },
        crypto.randomUUID(),
      );
      await this.refreshProducts();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Producto guardado sin conexión"
            : INVENTORY_TOASTS.productSaved,
      });
      return {
        id: result.mode === "offline" ? result.productId : result.product.id,
        mode: result.mode,
      };
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
  async patchSupplier(input: {
    supplierId: string;
    name: string;
    phone?: string | null;
    notes?: string | null;
    requestId?: string;
  }): Promise<"online" | "offline"> {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error(INVENTORY_ERRORS.emptySupplierName);
    try {
      const result = await patchSupplierWithOfflineFallback(
        input.supplierId,
        { name: trimmed, phone: input.phone ?? null, notes: input.notes ?? null },
        input.requestId ?? crypto.randomUUID(),
      );
      await this.refreshSuppliers();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Cambios guardados sin conexión"
            : INVENTORY_TOASTS.supplierSaved,
      });
      return result.mode;
    } catch (e) {
      fail(e);
    }
  },
  async patchProduct(input: {
    productId: string;
    name: string;
    priceRaw: string;
    lowStockAtRaw: string;
    sellable?: boolean;
    requestId?: string;
  }): Promise<"online" | "offline"> {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error(INVENTORY_ERRORS.emptyProductName);
    const price = Number.parseInt(input.priceRaw.trim() || "0", 10);
    if (!Number.isInteger(price) || price < 0) {
      throw new Error(INVENTORY_ERRORS.badCost);
    }
    const lowStockAt = Number.parseInt(input.lowStockAtRaw.trim() || "0", 10);
    if (!Number.isInteger(lowStockAt) || lowStockAt < 0) {
      throw new Error(INVENTORY_ERRORS.badCost);
    }
    try {
      const result = await patchProductWithOfflineFallback(
        input.productId,
        { name: trimmed, price, lowStockAt, sellable: input.sellable },
        input.requestId ?? crypto.randomUUID(),
      );
      await this.refreshProducts();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Cambios guardados sin conexión"
            : INVENTORY_TOASTS.productUpdated,
      });
      return result.mode;
    } catch (e) {
      fail(e);
    }
  },
  async archiveProduct(productId: string, requestId?: string): Promise<"online" | "offline"> {
    try {
      const result = await archiveProductWithOfflineFallback(
        productId,
        requestId ?? crypto.randomUUID(),
      );
      await this.refreshProducts();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Archivado sin conexión"
            : INVENTORY_TOASTS.productArchived,
      });
      return result.mode;
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
      const created = await createSupplierWithOfflineFallback(
        { name: input.supplierNameCreate.trim() },
        crypto.randomUUID(),
      );
      supplierId = created.mode === "offline" ? created.supplierId : created.supplier.id;
    }

    try {
      const move = await surtirWithOfflineFallback(
        {
          productId: input.productId,
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
      return move.mode === "offline" ? move.id : move.value.id;
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
      const move = await shrinkWithOfflineFallback(
        {
          productId: input.productId,
          qty: parsed.qty,
          reason: input.reason,
          note,
        },
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
      return move.mode === "offline" ? move.id : move.value.id;
    } catch (e) {
      fail(e);
    }
  },
  async preparar(input: {
    sourceId: string;
    targetId: string;
    qtyRaw: string;
    unitCostRaw: string;
    note?: string;
    requestId?: string;
  }): Promise<string> {
    const parsed = validatePreparationForm({
      sourceId: input.sourceId,
      targetId: input.targetId,
      qtyRaw: input.qtyRaw,
      unitCostRaw: input.unitCostRaw,
    });
    if ("error" in parsed) throw new Error(parsed.error);
    try {
      const result = await prepararWithOfflineFallback(
        {
          sourceId: parsed.sourceId,
          targetId: parsed.targetId,
          qty: parsed.qty,
          unitCost: parsed.unitCost,
          note: input.note?.trim() || undefined,
        },
        input.requestId ?? crypto.randomUUID(),
      );
      await this.refreshProducts();
      setState({
        lastToast:
          result.mode === "offline"
            ? "Preparación guardada sin conexión"
            : `Preparadas ${parsed.qty} unidades`,
      });
      return result.mode === "offline" ? result.id : result.value.id;
    } catch (e) {
      fail(e);
    }
  },
  async listPreparations(filter?: {
    sourceId?: string;
    targetId?: string;
  }): Promise<RemotePreparation[]> {
    const { rows } = await listPreparationsWithOfflineFallback(filter);
    return rows;
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
    patchSupplier: inventoryStore.patchSupplier.bind(inventoryStore),
    patchProduct: inventoryStore.patchProduct.bind(inventoryStore),
    archiveProduct: inventoryStore.archiveProduct.bind(inventoryStore),
    surtir: inventoryStore.surtir.bind(inventoryStore),
    applyShrink: inventoryStore.applyShrink.bind(inventoryStore),
    todayLocalDateInput: inventoryStore.todayLocalDateInput,
    clearToast: inventoryStore.clearToast,
  };
}
