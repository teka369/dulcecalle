/** Integer COP as bigint. JSON serializes to number (see bigint.ts). */

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
