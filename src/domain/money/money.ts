/** Integer Colombian pesos (COP). Never use floats for money. */
export type Cop = number & { readonly __brand: "Cop" };

export function asCop(n: number): Cop {
  if (!Number.isInteger(n)) {
    throw new Error(`COP must be an integer, got ${n}`);
  }
  return n as Cop;
}

export function toCop(n: number): Cop {
  return asCop(Math.trunc(n));
}

/** Display: `$ 1.500` (es-CO, 0 fraction digits). */
export function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(asCop(Math.trunc(n)));
}

export function addCop(a: number, b: number): Cop {
  return asCop(Math.trunc(a) + Math.trunc(b));
}

export function subCop(a: number, b: number): Cop {
  return asCop(Math.trunc(a) - Math.trunc(b));
}

export function mulCop(unit: number, qty: number): Cop {
  if (!Number.isInteger(qty)) {
    throw new Error(`Quantity must be an integer, got ${qty}`);
  }
  return asCop(Math.trunc(unit) * qty);
}
