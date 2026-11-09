/**
 * C07.1 (C07-QA-01) — the «Corregir pago» preview is the dry-run of
 * `correct` (not `reverse`), so it includes the replacement abono: money in,
 * its customer's debt and the netted caja. Nothing is written (J4).
 */
import type { HttpRepository, ReversalBody, ReversalResult } from "@/data/http/repository";

export type CorrectReplacement = Parameters<HttpRepository["reversals"]["correctPayment"]>[2]["replacement"];

export function correctPaymentPreview(
  reversals: Pick<HttpRepository["reversals"], "correctPayment">,
  customerId: string,
  paymentId: string,
  body: ReversalBody,
  replacement: CorrectReplacement,
): Promise<ReversalResult> {
  return reversals.correctPayment(customerId, paymentId, { ...body, replacement }, { dryRun: true });
}
