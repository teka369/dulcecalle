/**
 * C04 W1 — «Aplicar a» choice → preview table and wire target. Pure.
 * The preview uses the same planner as the API (src/domain/allocation.ts);
 * the server response replaces it (T2, T20).
 */
import {
  AllocationInvalidError,
  planAllocation,
  type AllocationTargetInput,
  type Overflow,
} from "@/domain/allocation";
import type { OpenObligation } from "@/data/pwa/customer-allocations";
import type { PaymentTarget } from "@/data/http/repository";

export type AbonoChoice =
  | { mode: "fifo" }
  | { mode: "sale"; obligationId: string | null }
  | { mode: "split"; amounts: Record<string, string> };

export type PreviewRow = {
  key: string;
  label: string;
  before: number;
  after: number;
  changed: boolean;
};

export type AbonoPreview = {
  rows: PreviewRow[];
  toCredit: number;
  debtBefore: number;
  debtAfter: number;
  /** Not yet applied in a split (goes oldest first, or by overflow). */
  splitAssigned: number;
  /** Per-obligation error in «Repartir». */
  fieldErrors: Record<string, string>;
  error: string | null;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

export function obligationKey(o: { kind: string; id: string }): string {
  return `${o.kind}:${o.id}`;
}

function splitTargets(choice: Extract<AbonoChoice, { mode: "split" }>, obligations: OpenObligation[]) {
  const out: Array<{ o: OpenObligation; amount: number }> = [];
  for (const o of obligations) {
    const raw = choice.amounts[obligationKey(o)] ?? "";
    const n = Number.parseInt(raw.replace(/\D/g, ""), 10);
    if (Number.isInteger(n) && n > 0) out.push({ o, amount: n });
  }
  return out;
}

export function buildAbonoPreview(input: {
  amount: number | null;
  debt: number;
  obligations: OpenObligation[];
  choice: AbonoChoice;
  overflow: Overflow;
}): AbonoPreview {
  const { obligations, choice } = input;
  const base: AbonoPreview = {
    rows: obligations
      .filter((o) => o.open > 0)
      .map((o) => ({ key: obligationKey(o), label: o.label, before: o.open, after: o.open, changed: false })),
    toCredit: 0,
    debtBefore: input.debt,
    debtAfter: input.debt,
    splitAssigned: 0,
    fieldErrors: {},
    error: null,
  };
  const amount = input.amount;
  if (amount == null || !Number.isInteger(amount) || amount <= 0) return base;

  const fieldErrors: Record<string, string> = {};
  let target: AllocationTargetInput = { mode: "fifo" };
  if (choice.mode === "sale") {
    if (!choice.obligationId) return base;
    target = { mode: "sale", saleId: choice.obligationId };
  } else if (choice.mode === "split") {
    const picked = splitTargets(choice, obligations);
    for (const { o, amount: want } of picked) {
      if (want > o.open) fieldErrors[obligationKey(o)] = `No puede ser más que lo pendiente (${fmt(o.open)}).`;
    }
    base.splitAssigned = picked.reduce((a, x) => a + x.amount, 0);
    if (Object.keys(fieldErrors).length > 0) return { ...base, fieldErrors, error: null };
    if (base.splitAssigned > amount) {
      return { ...base, error: "Lo repartido no puede ser más que el abono." };
    }
    if (picked.length > 0) {
      target = {
        mode: "split",
        targets: picked.map(({ o, amount: a }) => ({ kind: o.kind, id: o.id, amount: a })),
      };
    }
  }
  try {
    const plan = planAllocation({
      amount,
      obligations,
      target,
      overflow: input.overflow,
      cap: Math.max(0, input.debt),
    });
    const after = new Map<string, number>();
    for (const l of plan.lines) if (l.id) after.set(`${l.targetType}:${l.id}`, l.openAfter);
    return {
      ...base,
      rows: base.rows.map((r) =>
        after.has(r.key) ? { ...r, after: after.get(r.key)!, changed: after.get(r.key) !== r.before } : r,
      ),
      toCredit: plan.toCredit,
      debtAfter: input.debt - plan.toObligations,
    };
  } catch (e) {
    if (e instanceof AllocationInvalidError) return { ...base, error: e.message };
    throw e;
  }
}

/** Wire fields for POST /customers/:id/payments (omit = FIFO, C02 hash compatible). */
export function wireTarget(
  choice: AbonoChoice,
  obligations: OpenObligation[],
  overflow: Overflow,
): { target?: PaymentTarget; overflow?: Overflow; dependsOnOperationId?: string } {
  if (choice.mode === "sale" && choice.obligationId) {
    const o = obligations.find((x) => x.kind === "sale" && x.id === choice.obligationId);
    if (!o) return {};
    const target: PaymentTarget = o.localRequestId
      ? { mode: "sale", saleRequestId: o.localRequestId }
      : { mode: "sale", saleId: o.id };
    return {
      target,
      ...(overflow === "credit" ? { overflow } : {}),
      ...(o.localOperationId ? { dependsOnOperationId: o.localOperationId } : {}),
    };
  }
  if (choice.mode === "split") {
    const picked = splitTargets(choice, obligations).filter(({ o }) => !o.localRequestId);
    if (picked.length === 0) return {};
    return {
      target: {
        mode: "split",
        targets: picked.map(({ o, amount }) =>
          o.kind === "sale" ? { saleId: o.id, amount } : { initialDebtId: o.id, amount },
        ),
      },
      ...(overflow === "credit" ? { overflow } : {}),
    };
  }
  return {};
}
