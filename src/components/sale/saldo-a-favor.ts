/**
 * C04 W7 — «Usar saldo a favor» in Cobrar. Pure.
 * Offered only online (J3); offline the line is information only and the
 * sale never carries `applyCredit` (T34).
 */
export function saldoAFavorView(input: {
  creditBalance: number;
  /** What this sale leaves owed before saldo (fiado part). */
  owedOnSale: number;
  online: boolean;
  using: boolean;
}) {
  const creditBalance = Math.max(0, input.creditBalance);
  const usable = Math.min(creditBalance, Math.max(0, input.owedOnSale));
  const visible = creditBalance > 0;
  const offerable = visible && input.online && usable > 0;
  const applied = offerable && input.using ? usable : 0;
  return {
    visible,
    offerable,
    creditBalance,
    usable,
    applied,
    remaining: Math.max(0, input.owedOnSale - applied),
  };
}
