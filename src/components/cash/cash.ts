/** Pure view helpers for Caja / Gastos / Estadísticas. Each metric keeps its own source field. */
import { CASH_COPY } from "@/domain/cash";
import { STATS_COPY } from "@/domain/stats";
import type { PayMethod } from "@/domain/types";

export type CashMoveLike = { kind: string; method: string; amount: number; direction: string };
export type Expected = { efectivo: number; nequi: number; total: number };

export function kindLabel(kind: string): string {
  switch (kind) {
    case "expense":
      return "Gasto";
    case "retiro":
      return CASH_COPY.retiroPersonal;
    case "aporte":
      return CASH_COPY.aporteCapital;
    case "sale":
      return "Venta";
    case "debt_collect":
      return "Abono";
    case "compra":
      return "Compra";
    case "devolucion":
      return "Devolución";
    default:
      return kind;
  }
}

/** Same totals cashStore derives (in → entradas, out → salidas). */
export function summarizeMoves(moves: ReadonlyArray<CashMoveLike>): { entradas: number; salidas: number; neto: number } {
  let entradas = 0;
  let salidas = 0;
  for (const m of moves) {
    if (m.direction === "in") entradas += m.amount;
    else salidas += m.amount;
  }
  return { entradas, salidas, neto: entradas - salidas };
}

export function moveSign(m: Pick<CashMoveLike, "direction">): { sign: "+" | "−"; word: "Entra" | "Sale"; tone: "ok" | "danger" } {
  return m.direction === "in" ? { sign: "+", word: "Entra", tone: "ok" } : { sign: "−", word: "Sale", tone: "danger" };
}

export type CashFormKind = "aporte" | "retiro" | "gasto";

/** Aporte enters the caja; retiro and gasto leave it. Only the chosen method's bucket moves. */
export const CASH_FORM_DIRECTION: Record<CashFormKind, 1 | -1> = { aporte: 1, retiro: -1, gasto: -1 };

/** Client preview of expected after a form move (never sent; server stays the source). */
export function expectedAfter(expected: Expected, kind: CashFormKind, method: PayMethod, amount: number): Expected {
  const d = CASH_FORM_DIRECTION[kind] * amount;
  const efectivo = expected.efectivo + (method === "Efectivo" ? d : 0);
  const nequi = expected.nequi + (method === "Nequi" ? d : 0);
  return { efectivo, nequi, total: efectivo + nequi };
}

/** Live close difference: Contado − Esperado efectivo, with a word (not colour only). */
export function closeDifference(counted: number | null, expectedEfectivo: number) {
  if (counted == null) return null;
  const diff = counted - expectedEfectivo;
  const word = diff === 0 ? "Cuadra" : diff > 0 ? "Sobra" : "Falta";
  const tone = diff === 0 ? "ok" : diff > 0 ? "ok" : "danger";
  return { diff, abs: Math.abs(diff), word, tone } as const;
}

export type StatsLike = {
  ventas: number;
  ventasCount: number;
  devoluciones: number;
  recibido: number;
  recibidoEfectivo: number;
  recibidoNequi: number;
  porCobrar: number;
  gaste: number;
  inverti: number;
  valorInventario: number;
  stockBajo: number;
  ganancia: number;
};

/** DINERO 2×2. Each cell reads exactly one field; nothing is summed or mixed. */
export function dineroCells(s: StatsLike) {
  return [
    { key: "recibido", label: STATS_COPY.recibido, value: s.recibido, caption: STATS_COPY.captionRecibido },
    { key: "porCobrar", label: STATS_COPY.porCobrar, value: s.porCobrar, caption: STATS_COPY.captionPorCobrar },
    { key: "gaste", label: STATS_COPY.gaste, value: s.gaste, caption: STATS_COPY.captionGaste },
    { key: "inverti", label: STATS_COPY.inverti, value: s.inverti, caption: STATS_COPY.captionInverti },
  ] as const;
}

export function sumAmounts(list: ReadonlyArray<{ amount: number }>): number {
  return list.reduce((a, b) => a + b.amount, 0);
}

const WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** §3.22 short Bogotá day label from a YYYY-MM-DD local date: «mar 13 oct». */
export function shortDay(localDate: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(localDate ?? "");
  if (!m) return localDate ?? "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${WD[wd]} ${d} ${MO[mo - 1]}`;
}
