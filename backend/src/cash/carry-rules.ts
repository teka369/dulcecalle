/** Pure carry decisions. No I/O. */

export type CarryMode = "counted" | "assumed";

export type ExpectedMove = {
  amount: bigint;
  direction: "in" | "out";
  method: string;
  sessionId: string | null;
  pendingForSessionId: string | null;
};

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

/** Efectivo continuity added to the destination without touching openingFloat. */
export function carriedEfectivoDelta(previousExpectedEfectivo: bigint): bigint {
  return previousExpectedEfectivo;
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

export function belongsToSession(
  move: { sessionId: string | null; pendingForSessionId: string | null },
  sessionId: string,
): boolean {
  return (
    move.sessionId === sessionId ||
    (move.sessionId == null && move.pendingForSessionId === sessionId)
  );
}

export function sessionExpected(input: {
  sessionId: string;
  openingFloat: bigint;
  carriedEfectivo: bigint;
  moves: ExpectedMove[];
}): { efectivo: bigint; nequi: bigint } {
  let efectivo = input.openingFloat + input.carriedEfectivo;
  let nequi = 0n;
  for (const move of input.moves) {
    if (!belongsToSession(move, input.sessionId)) continue;
    const delta = move.direction === "in" ? move.amount : -move.amount;
    if (move.method === "Efectivo") efectivo += delta;
    else if (move.method === "Nequi") nequi += delta;
  }
  return { efectivo, nequi };
}
