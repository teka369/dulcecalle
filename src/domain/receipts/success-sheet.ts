import { formatCop } from "@/domain/money";

/**
 * C09-PR6 — success sheet after a sale or an abono (SPEC-C09 §5.1, §11.2-3,
 * WIRES-C09 W2). Pure view model: no I/O, no status (a just-issued receipt is
 * always vigente), never the reversal reasonText.
 */

/** `receipts[]` item returned by POST /sales and POST /customers/:id/payments. */
export type ReceiptRef = { id: string; kind: string; number: string; verifyCode: string };

export const LINK_NOTICE = "El enlace sirve una vez por 48 horas y pide el PIN del cliente.";
export const OFFLINE_LINK_NOTICE = "El enlace estará cuando se envíe.";

export function mapReceiptRefs(raw: unknown): ReceiptRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.kind !== "string" || typeof o.number !== "string" || typeof o.verifyCode !== "string") return [];
    return [{ id: o.id, kind: o.kind, number: o.number, verifyCode: o.verifyCode }];
  });
}

/** The operation's own receipt (not an allocation annex). */
export function shareableReceipt(refs: ReceiptRef[] | undefined, kind: "sale" | "payment"): ReceiptRef | null {
  return refs?.find((r) => r.kind === kind) ?? null;
}

export type SuccessInput =
  | { op: "sale" | "payment"; mode: "online"; number?: string | null; receipt?: ReceiptRef | null; hasCustomer: boolean; amount: number }
  | { op: "sale" | "payment"; mode: "offline"; localRef?: string | null; hasCustomer: boolean; amount: number };

export type SuccessView = {
  title: string;
  /** «Ref. local L-…» while it is only on this phone. */
  reference: string | null;
  /** Link actions (WhatsApp / copiar / enviar): online, with a customer and a receipt id. */
  canLink: boolean;
  linkNotice: string | null;
  offlineNotice: string | null;
  /** Text for «Compartir texto» (no link). */
  plainText: string;
};

const OP_LABEL = { sale: "Venta", payment: "Abono" } as const;

export function successView(input: SuccessInput): SuccessView {
  const amount = formatCop(input.amount);
  if (input.mode === "offline") {
    const ref = input.localRef ? `Ref. local ${input.localRef}` : null;
    return {
      title: input.op === "sale" ? "Venta guardada en este teléfono" : "Abono guardado en este teléfono",
      reference: ref,
      canLink: false,
      linkNotice: null,
      offlineNotice: input.hasCustomer ? OFFLINE_LINK_NOTICE : null,
      plainText: [OP_LABEL[input.op], amount, ref].filter(Boolean).join(" · "),
    };
  }
  const number = input.number ?? input.receipt?.number ?? null;
  const canLink = input.hasCustomer && !!input.receipt;
  return {
    title: number ? `Listo · ${number}` : input.op === "sale" ? "Venta registrada" : "Abono registrado",
    reference: null,
    canLink,
    linkNotice: canLink ? LINK_NOTICE : null,
    offlineNotice: null,
    plainText: number ? `Comprobante ${number} · ${amount}` : `${OP_LABEL[input.op]} · ${amount}`,
  };
}

/** SPEC-C09 §5.1: «Tu comprobante DC-000125: <url>». */
export function linkShareText(number: string, url: string): string {
  return `Tu comprobante ${number}: ${url}`;
}

/** wa.me without a phone: the owner picks the chat (no customer phone is sent). */
export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
