import type { PayMethod, StockMoveReason } from "@/domain/types";

/** Exact Escritor Tanda 3 FINAL error / toast strings. */
export const INVENTORY_ERRORS = {
  emptyQty: "Escribe la cantidad.",
  notPositive: "La cantidad tiene que ser mayor a 0.",
  insufficientStock: "No hay suficiente stock.",
  badCost: "Revisa el costo.",
  noMethod: "Elige Efectivo o Nequi.",
  emptyMotivo: "Cuéntanos qué pasó.",
  emptyProductName: "Ponle un nombre al producto.",
  emptySupplierName: "Ponle un nombre al proveedor.",
  stockViaMoves:
    "El stock solo cambia con surtir, ventas, mermas, devoluciones o el alta inicial.",
  inicialViaCreate: "El stock inicial solo se registra al crear el producto.",
  needCost: "Si hay stock, ponle lo que te costó.",
  surtirTodayOnly: "El surtido queda en el día de hoy.",
} as const;

export const INVENTORY_TOASTS = {
  surtir: "Stock actualizado",
  meLoComi: "Listo, descontado del stock",
  regalo: "Regalo registrado",
  perdido: "Pérdida registrada",
  supplierSaved: "Proveedor guardado",
  productSaved: "Producto guardado",
  productUpdated: "Producto actualizado",
  productArchived: "Producto archivado",
} as const;

/** Note on the `inicial` stockMove when the opening units were a gift. */
export const GIFTED_STOCK_NOTE = "Me lo regalaron / costo desconocido";

export type ShrinkReason = Extract<
  StockMoveReason,
  "me_lo_comi" | "regalar" | "perdido"
>;

/**
 * Parse qty raw field.
 * empty → emptyQty; non-positive / NaN → notPositive.
 */
export function parseQtyRaw(qtyRaw: string): { qty: number } | { error: string } {
  const raw = qtyRaw.trim();
  if (raw === "") return { error: INVENTORY_ERRORS.emptyQty };
  const qty = Number.parseInt(raw, 10);
  if (!Number.isFinite(qty) || Number.isNaN(qty)) {
    return { error: INVENTORY_ERRORS.emptyQty };
  }
  if (qty <= 0) return { error: INVENTORY_ERRORS.notPositive };
  return { qty };
}

/** Outbound shrink qty must be ≤ current stock. */
export function validateShrinkQty(
  qtyRaw: string,
  stock: number,
): { qty: number } | { error: string } {
  const parsed = parseQtyRaw(qtyRaw);
  if ("error" in parsed) return parsed;
  if (parsed.qty > stock) {
    return { error: INVENTORY_ERRORS.insufficientStock };
  }
  return parsed;
}

export function validateMotivo(motivoRaw: string): string | null {
  if (motivoRaw.trim() === "") return INVENTORY_ERRORS.emptyMotivo;
  return null;
}

/**
 * Reconcile surtir costs so qty, unitCost and totalCost cannot contradict.
 *
 * Source of truth:
 * - If unit × qty === total → keep both (already consistent).
 * - If total > 0 and they differ → total is cash out; unitCost = round(total / qty).
 * - If total === 0 → stock-only surtir; keep unitCost for weighted avg, no cash out.
 */
export function reconcileSurtirCost(
  qty: number,
  unitCost: number,
  totalCost: number,
): { unitCost: number; totalCost: number } {
  const unit = Math.trunc(unitCost);
  const total = Math.trunc(totalCost);
  if (unit * qty === total) {
    return { unitCost: unit, totalCost: total };
  }
  if (total > 0) {
    return { unitCost: Math.round(total / qty), totalCost: total };
  }
  return { unitCost: unit, totalCost: 0 };
}

/**
 * Resolve unit + total cost (integer COP).
 * - Both empty → unit 0, total 0 (stock-only surtir; no cash out).
 * - Only unit → total = unit * qty (exact integer mul).
 * - Only total → unit = Math.round(total / qty)  // ROUND, not floor
 * - Both → reconcileSurtirCost (total wins if they contradict).
 * Invalid (negative / non-int) → badCost.
 */
export function resolveSurtirCost(input: {
  qty: number;
  unitCostRaw: string;
  totalCostRaw: string;
}): { unitCost: number; totalCost: number } | { error: string } {
  const unitRaw = input.unitCostRaw.trim();
  const totalRaw = input.totalCostRaw.trim();

  const parseOpt = (raw: string): number | null | "bad" => {
    if (raw === "") return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || Number.isNaN(n) || !Number.isInteger(n)) {
      return "bad";
    }
    if (n < 0) return "bad";
    return n;
  };

  const unit = parseOpt(unitRaw);
  const total = parseOpt(totalRaw);
  if (unit === "bad" || total === "bad") {
    return { error: INVENTORY_ERRORS.badCost };
  }

  if (unit == null && total == null) {
    return { unitCost: 0, totalCost: 0 };
  }
  if (unit != null && total == null) {
    return { unitCost: unit, totalCost: unit * input.qty };
  }
  if (unit == null && total != null) {
    return {
      unitCost: Math.round(total / input.qty),
      totalCost: total,
    };
  }
  return reconcileSurtirCost(input.qty, unit!, total!);
}

export function validatePayMethod(
  method: PayMethod | null | undefined,
): string | null {
  if (method !== "Efectivo" && method !== "Nequi") {
    return INVENTORY_ERRORS.noMethod;
  }
  return null;
}

/** Full surtir form validation (UI → store). */
export function validateSurtirForm(input: {
  qtyRaw: string;
  unitCostRaw: string;
  totalCostRaw: string;
  method: PayMethod | null | undefined;
}):
  | { qty: number; unitCost: number; totalCost: number; method: PayMethod }
  | { error: string } {
  const qtyParsed = parseQtyRaw(input.qtyRaw);
  if ("error" in qtyParsed) return qtyParsed;

  const cost = resolveSurtirCost({
    qty: qtyParsed.qty,
    unitCostRaw: input.unitCostRaw,
    totalCostRaw: input.totalCostRaw,
  });
  if ("error" in cost) return cost;

  const methodErr = validatePayMethod(input.method);
  if (methodErr) return { error: methodErr };

  return {
    qty: qtyParsed.qty,
    unitCost: cost.unitCost,
    totalCost: cost.totalCost,
    method: input.method as PayMethod,
  };
}
