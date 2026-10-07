import { dateKey } from "../shared/clock";

type OpenSession = { id: string; localDate: Date };

/**
 * Attach a new cash move without guessing among several open sessions.
 * Historical rows are never updated here.
 */
export function linkForNewMove(
  opens: OpenSession[],
  occurredOn: Date,
): { sessionId: string | null; pendingForSessionId: string | null } {
  const day = dateKey(occurredOn);
  const sameDay = opens.find((session) => dateKey(session.localDate) === day);
  if (sameDay) return { sessionId: sameDay.id, pendingForSessionId: null };
  if (opens.length === 1 && dateKey(opens[0].localDate) < day) {
    return { sessionId: null, pendingForSessionId: opens[0].id };
  }
  return { sessionId: null, pendingForSessionId: null };
}

export const ASSUMED_CLOSE_NOTE =
  "Cierre asumido por paso de saldo, sin conteo físico";
