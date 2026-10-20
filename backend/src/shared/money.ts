/** Integer COP as bigint. JSON serializes to number (see bigint.ts). */

/**
 * Ceiling for any single COP amount accepted by a write DTO: 100.000.000 COP.
 * Mirrors the PWA (src/domain/money/limits.ts). Keeps every derived sum
 * (expected caja, deuda, inventario) inside Number.MAX_SAFE_INTEGER so
 * copToJson never has to emit an unsafe number.
 */
export const MAX_COP_AMOUNT = 100_000_000;
export const MAX_COP_MESSAGE = "El monto es demasiado grande. El máximo es $ 100.000.000.";

export function asCop(n: bigint | number | string): bigint {
  if (typeof n === "bigint") return n;
  if (typeof n === "number") {
    if (!Number.isInteger(n)) {
      throw new Error(`COP must be an integer, got ${n}`);
    }
    return BigInt(n);
  }
  return BigInt(n);
}

export function addCop(a: bigint, b: bigint): bigint {
  return a + b;
}

export function subCop(a: bigint, b: bigint): bigint {
  return a - b;
}

export function mulCop(unit: bigint, qty: number): bigint {
  if (!Number.isInteger(qty)) {
    throw new Error(`Quantity must be an integer, got ${qty}`);
  }
  return unit * BigInt(qty);
}

/** JSON COP: number. Candy-cart amounts stay inside MAX_SAFE_INTEGER. */
export function copToJson(n: bigint): number {
  const v = Number(n);
  if (!Number.isSafeInteger(v)) {
    throw new Error("COP out of JSON-safe integer range");
  }
  return v;
}
