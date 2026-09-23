import { asCop } from "./money";

/**
 * Combo/insumo (`sellable: false`) stores remaining LOT VALUE in avgCost,
 * not a per-unit average. Surtir must add the cash outlay to that pool.
 * Sellable products keep the historical weighted unit average.
 */
export function nextAvgCostAfterSurtir(input: {
  sellable: boolean;
  stock: number;
  avgCost: bigint;
  qty: number;
  unitCost: bigint;
  totalCost: bigint;
}): bigint {
  if (!input.sellable) {
    return asCop(input.avgCost) + asCop(input.totalCost);
  }
  return weightedAvgCost(input.stock, input.avgCost, input.qty, input.unitCost);
}

/** Opening avgCost: unit cost for sellable; unit×stock lot pool for combos. */
export function openingStoredAvgCost(input: {
  sellable: boolean;
  stock: number;
  unitCost: bigint;
}): bigint {
  const unit = asCop(input.unitCost);
  if (!input.sellable && input.stock > 0) return unit * BigInt(input.stock);
  return unit;
}

/** Integer weighted avg. Matches PWA Math.round for non-negative COP. */
export function weightedAvgCost(
  oldStock: number,
  oldAvg: bigint,
  addQty: number,
  unitCost: bigint,
): bigint {
  if (addQty < 0) throw new Error("addQty must be ≥ 0");
  const newStock = oldStock + addQty;
  if (newStock <= 0) return asCop(oldAvg);
  const total = asCop(oldAvg) * BigInt(oldStock) + asCop(unitCost) * BigInt(addQty);
  const denom = BigInt(newStock);
  const q = total / denom;
  const r = total % denom;
  if (r * 2n >= denom) return q + 1n;
  return q;
}

/** Total wins if unit×qty ≠ total and total > 0. Stock-only if total === 0. */
export function reconcileSurtirCost(
  qty: number,
  unitCost: bigint,
  totalCost: bigint,
): { unitCost: bigint; totalCost: bigint } {
  const unit = asCop(unitCost);
  const total = asCop(totalCost);
  if (unit * BigInt(qty) === total) {
    return { unitCost: unit, totalCost: total };
  }
  if (total > 0n) {
    const denom = BigInt(qty);
    const q = total / denom;
    const r = total % denom;
    const rounded = r * 2n >= denom ? q + 1n : q;
    return { unitCost: rounded, totalCost: total };
  }
  return { unitCost: unit, totalCost: 0n };
}
