/** Pure view helpers for the Clientes pages (no I/O, no domain math changes). */
import { abonoRemainingHelper, parseAbonoAmount, validateAbono } from "@/domain/abono";
import type { DebtEntry } from "@/domain/debt/statement";
import type { PayMethod } from "@/domain/types";

export type CustomerLike = { id: string; name: string; code?: string | null; debt: number };
export type ClientesSegment = "deben" | "todos";

/** POR COBRAR: Σ debt>0 and number of customers that owe. */
export function porCobrar(list: ReadonlyArray<CustomerLike>): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const c of list) {
    if (c.debt > 0) {
      total += c.debt;
      count += 1;
    }
  }
  return { total, count };
}

/** Debtors first (desc debt), then alphabetical (es). */
export function sortCustomers<T extends CustomerLike>(list: ReadonlyArray<T>): T[] {
  return [...list].sort((a, b) => {
    const ad = a.debt > 0 ? 1 : 0;
    const bd = b.debt > 0 ? 1 : 0;
    if (ad !== bd) return bd - ad;
    if (ad && a.debt !== b.debt) return b.debt - a.debt;
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });
}

/** UI filter over loaded data: segment + name/code search. */
export function filterCustomers<T extends CustomerLike>(
  list: ReadonlyArray<T>,
  query: string,
  segment: ClientesSegment,
): T[] {
  const q = query.trim().toLowerCase();
  return sortCustomers(list).filter((c) => {
    if (segment === "deben" && !(c.debt > 0)) return false;
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.code ?? "").toLowerCase().includes(q);
  });
}

export type StatementRowView = {
  sign: "+" | "−";
  /** Amount that moves the balance (fiado = credit, never saleTotal/amountReceived). */
  amount: number;
  tone: "danger" | "ok";
  /** Word shown next to the sign so meaning isn't colour only. */
  word: "Cargo" | "Abono";
  label: string;
  href: string | null;
};

export function statementRow(entry: DebtEntry): StatementRowView {
  switch (entry.kind) {
    case "inicial":
      return { sign: "+", amount: entry.amount, tone: "danger", word: "Cargo", label: "Deuda anterior", href: null };
    case "abono":
      return { sign: "−", amount: entry.amount, tone: "ok", word: "Abono", label: `Abono · ${entry.method}`, href: null };
    case "devolucion":
      return {
        sign: "−",
        amount: entry.amount,
        tone: "ok",
        word: "Abono",
        label: entry.pending ? "Devolución · pendiente" : "Devolución",
        href: null,
      };
    default: {
      const n = String(entry.fiadoIndex).padStart(3, "0");
      return {
        sign: "+",
        amount: entry.credit,
        tone: "danger",
        word: "Cargo",
        label: entry.kind === "parcial" ? `Fiado parcial · Venta #${n}` : `Fiado · Venta #${n}`,
        href: `/ventas/${entry.saleId}`,
      };
    }
  }
}

export const ABONO_METHODS: ReadonlyArray<{ id: PayMethod; label: string }> = [
  { id: "Efectivo", label: "Efectivo" },
  { id: "Nequi", label: "Nequi" },
];

/** Abono form view state: validity, remaining, and the «Todo $X» chip value. */
export function abonoView(debt: number, amountRaw: string, method: PayMethod) {
  const amount = amountRaw.trim() === "" ? null : parseAbonoAmount(amountRaw);
  const error = validateAbono({ amountRaw, debt, method });
  return {
    valid: error === null,
    error,
    remaining: amount != null && error === null ? debt - amount : null,
    remainingText: amount != null && Number.isFinite(amount) ? abonoRemainingHelper(debt, amount) : null,
    fullChip: debt > 0 ? String(debt) : null,
    method,
  };
}
