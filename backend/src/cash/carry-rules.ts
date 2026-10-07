/** Pure carry decisions. No I/O. */

export type CarryMode = "counted" | "assumed";

export function carryModeAllowed(
  requested: CarryMode,
  stampedCount: number,
): { ok: true } | { ok: false; code: "ASSUMED_REQUIRED" } {
  if (requested === "counted" && stampedCount > 0) {
    return { ok: false, code: "ASSUMED_REQUIRED" };
  }
  return { ok: true };
}

export function continuityFloat(input: {
  mode: CarryMode;
  countedEfectivo: bigint | null;
  previousExpectedEfectivo: bigint;
  destinationAlreadyOpen: boolean;
  destinationOpeningFloat: bigint | null;
}): bigint | null {
  if (input.destinationAlreadyOpen) return null;
  if (input.mode === "counted") return input.countedEfectivo ?? 0n;
  return input.previousExpectedEfectivo;
}

export function inCarrySet(input: {
  sessionId: string | null;
  pendingForSessionId: string | null;
  occurredOn: string;
  previousId: string;
  previousLocalDate: string;
  carryLocalDate: string;
}): boolean {
  return (
    input.sessionId == null &&
    input.pendingForSessionId === input.previousId &&
    input.occurredOn > input.previousLocalDate &&
    input.occurredOn <= input.carryLocalDate
  );
}
