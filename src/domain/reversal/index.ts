/**
 * C07 — reversos y anulaciones (SPEC-C07, WIRES-C07). Pure helpers shared by
 * the sale detail, the customer sheet, caja and the portal.
 *
 * Rules the UI enforces (the server enforces them again):
 * - only the owner sees «Anular» / «Corregir»; staff never sees them (W1);
 * - only online: offline the button stays visible but disabled with
 *   «Necesita conexión para anular» and nothing is queued (W6, T18);
 * - a reason is required; free text only with «Otro» (decision 14);
 * - a reversal is final: a voided sale or abono has no more actions (G8).
 */
import { formatCop } from "@/domain/money";

export type ReversalReasonCode =
  | "error_digitacion"
  | "cliente_equivocado"
  | "monto_equivocado"
  | "duplicado"
  | "devolucion"
  | "otro";

export const REVERSAL_REASONS: ReadonlyArray<{ code: ReversalReasonCode; label: string }> = [
  { code: "error_digitacion", label: "Error de digitación" },
  { code: "cliente_equivocado", label: "Cliente equivocado" },
  { code: "monto_equivocado", label: "Monto equivocado" },
  { code: "duplicado", label: "Duplicado" },
  { code: "devolucion", label: "Devolución" },
  { code: "otro", label: "Otro" },
];

/** Same bounds as the server CHECK (SPEC §3.1): 5–280 after trim. */
export const REASON_TEXT_MIN = 5;
export const REASON_TEXT_MAX = 280;

export const OFFLINE_REVERSAL_TEXT = "Necesita conexión para anular";
export const UNDO_WINDOW_MS = 2 * 60 * 1000;

export function reasonLabel(code: string | null | undefined): string {
  return REVERSAL_REASONS.find((r) => r.code === code)?.label ?? "Otro";
}

/** null = ok; otherwise the copy to show under the field. */
export function reasonError(code: ReversalReasonCode | null, text: string): string | null {
  if (!code) return "Elige un motivo.";
  const t = text.trim();
  if (code === "otro" && t.length === 0) return "Cuéntanos qué pasó (5 a 280 caracteres).";
  if (t.length > 0 && (t.length < REASON_TEXT_MIN || t.length > REASON_TEXT_MAX)) {
    return "Cuéntanos qué pasó (5 a 280 caracteres).";
  }
  return null;
}

/** Body sent to the API: text only with «Otro» (decision 14). */
export function reasonBody(code: ReversalReasonCode, text: string): { reasonCode: ReversalReasonCode; reasonText?: string } {
  const t = text.trim();
  return code === "otro" && t ? { reasonCode: code, reasonText: t } : { reasonCode: code };
}

export type ReversalActionState = "hidden" | "disabled" | "enabled";

/** W1 / W6: staff → hidden; already voided → hidden; offline → disabled. */
export function reversalActionState(args: { isOwner: boolean | null; online: boolean; reversed: boolean }): ReversalActionState {
  if (args.isOwner !== true || args.reversed) return "hidden";
  return args.online ? "enabled" : "disabled";
}

/** UX-ventas §6 — «Deshacer» only for the owner, online, within 2 minutes. */
export function canUndoSale(args: { createdAt: number; now: number; isOwner: boolean | null; online: boolean; reversed: boolean; pending?: boolean }): boolean {
  if (args.isOwner !== true || !args.online || args.reversed || args.pending) return false;
  const age = args.now - args.createdAt;
  return age >= 0 && age <= UNDO_WINDOW_MS;
}

export type ReversalRefLike = { number: string; reasonCode: string; createdAt?: number | string | null };

/** «Anulada · Monto equivocado» (sale) / «Anulado · …» (abono). Never the free text. */
export function reversalBadge(kind: "sale" | "payment", r: ReversalRefLike): string {
  return `${kind === "sale" ? "Anulada" : "Anulado"} · ${reasonLabel(r.reasonCode)}`;
}

export type ReversalEffects = {
  cashMoves?: Array<{ method: string; amount: number }>;
  stockMoves?: Array<{ productId: string; delta: number }>;
  debtBefore?: number | null;
  debtAfter?: number | null;
  creditBefore?: number | null;
  creditAfter?: number | null;
  cashOut?: number;
  target?: { customerId?: string | null; occurredOn?: string };
};

/** C07.1 — «Corregir pago» dry-run: the replacement abono (C04) after the reverso. */
export type ReplacementPreview = {
  customerId: string;
  amount: number;
  method: string;
  debtBefore?: number | null;
  debtAfter?: number | null;
  creditBefore?: number | null;
  creditAfter?: number | null;
  /** Expected caja after the reverso AND the new abono. */
  expectedEfectivoAfter?: number | null;
  expectedNequiAfter?: number | null;
};

export type ReversalPreview = {
  effects: ReversalEffects;
  warnings: string[];
  blockers?: string[];
  after?: { cash?: { expectedEfectivo?: number | null } };
  replacementPreview?: ReplacementPreview;
};

/**
 * W2 «Qué pasa al anular» — lines built from the dry-run response (J4).
 * With a «Corregir pago» dry-run (`replacementPreview`) the new abono is part
 * of the preview: money in, its customer's debt and the netted caja (C07.1).
 */
export function previewLines(p: ReversalPreview, firstName: string | null, replacementName?: string | null): string[] {
  const out: string[] = [];
  const e = p.effects ?? {};
  const r = p.replacementPreview;
  const same = !!r && !!e.target?.customerId && r.customerId === e.target.customerId;
  const units = (e.stockMoves ?? []).reduce((s, m) => s + Math.max(0, m.delta), 0);
  if (units > 0) out.push(`Vuelven al inventario: ${units} ${units === 1 ? "producto" : "productos"}`);
  const cash = e.cashMoves ?? [];
  if (cash.length === 0 && !r) out.push("No mueve la caja");
  for (const m of cash) {
    out.push(m.method === "Nequi" ? `Sale de Nequi: ${formatCop(m.amount)} (no cambia el efectivo)` : `Sale de la caja: ${formatCop(m.amount)} ${m.method}`);
  }
  if (r) {
    out.push(r.method === "Nequi" ? `Entra a Nequi: ${formatCop(r.amount)} (no cambia el efectivo)` : `Entra a la caja: ${formatCop(r.amount)} ${r.method}`);
  }
  const debtAfter = same && r?.debtAfter != null ? r.debtAfter : e.debtAfter;
  const creditAfter = same && r?.creditAfter != null ? r.creditAfter : e.creditAfter;
  if (e.debtBefore != null && debtAfter != null) {
    out.push(`Deuda${firstName ? ` de ${firstName}` : ""}: ${formatCop(e.debtBefore)} → ${formatCop(debtAfter)}`);
  }
  if (e.creditBefore != null && creditAfter != null && e.creditBefore !== creditAfter) {
    out.push(`Saldo a favor${same && firstName ? ` de ${firstName}` : ""}: ${formatCop(e.creditBefore)} → ${formatCop(creditAfter)}`);
  }
  if (r && !same) {
    const who = replacementName ? ` de ${replacementName}` : "";
    if (r.debtBefore != null && r.debtAfter != null) {
      out.push(`Deuda${who}: ${formatCop(r.debtBefore)} → ${formatCop(r.debtAfter)}`);
    }
    if (r.creditBefore != null && r.creditAfter != null && r.creditBefore !== r.creditAfter) {
      out.push(`Saldo a favor${who}: ${formatCop(r.creditBefore)} → ${formatCop(r.creditAfter)}`);
    }
  }
  const exp = r && r.expectedEfectivoAfter !== undefined ? r.expectedEfectivoAfter : p.after?.cash?.expectedEfectivo;
  const touchesEfectivo = cash.some((m) => m.method === "Efectivo") || r?.method === "Efectivo";
  if (typeof exp === "number" && touchesEfectivo) {
    out.push(`La caja esperada queda en ${formatMaybeNegative(exp)}`);
  }
  return out;
}

function formatMaybeNegative(n: number): string {
  return n < 0 ? `−${formatCop(-n)}` : formatCop(n);
}

/** Blockers from the dry-run → copy (W2 variants). */
export function blockerText(code: string): string {
  switch (code) {
    case "CASH_SESSION_REQUIRED":
      return "Abre la caja de hoy para anular.";
    case "CLOSED_DAY":
      return "Ese día ya se cerró. Abre la caja de hoy.";
    case "CONFIRM_OLD_REQUIRED":
      return "Es de hace más de 30 días: te pediremos confirmar.";
    default:
      return "No se puede anular ahora.";
  }
}

export function warningText(code: string, p?: ReversalPreview): string {
  if (code === "EXPECTED_CASH_NEGATIVE") {
    const r = p?.replacementPreview;
    const exp = r && r.expectedEfectivoAfter !== undefined ? r.expectedEfectivoAfter : p?.after?.cash?.expectedEfectivo;
    return typeof exp === "number"
      ? `La caja esperada quedará en ${formatMaybeNegative(exp)}. Revisa el efectivo.`
      : "La caja esperada quedará en negativo. Revisa el efectivo.";
  }
  return code;
}

/** Error codes of the reversal endpoints → copy (W2). */
export function reversalErrorText(code: string | undefined, kind: "sale" | "payment"): string {
  switch (code) {
    case "ALREADY_REVERSED":
      return kind === "sale" ? "Esta venta ya estaba anulada." : "Este pago ya estaba anulado.";
    case "CASH_SESSION_REQUIRED":
    case "CLOSED_DAY":
      return blockerText(code);
    case "NOTHING_TO_VOID":
      return "No queda nada por anular: ya se devolvió todo.";
    case "CREDIT_ALREADY_REFUNDED":
      return "El saldo a favor de este pago ya se devolvió en dinero. No se puede anular.";
    case "FORBIDDEN":
      return "Solo el dueño puede anular.";
    case "NETWORK":
      return OFFLINE_REVERSAL_TEXT;
    default:
      return "No se pudo anular. Intenta otra vez.";
  }
}

/** G4b — whole days between the original and today (date keys YYYY-MM-DD). */
export function daysOld(occurredOn: string, today: string): number {
  const a = Date.parse(`${occurredOn}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
