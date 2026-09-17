import { CASH_ERRORS, localDateKey } from "@/domain/cash";
import { getDb } from "@/storage/db";

/**
 * Central closed-day guard.
 *
 * A local calendar day is locked iff a cash session exists for that date
 * AND it has closedAt set. No session → mutations are allowed (same as
 * before S4: you can sell/surtir without opening caja).
 *
 * Use this from every financial or stock mutation — not only cashStore.
 */
export async function assertDayEditable(atMs: number = Date.now()): Promise<void> {
  const date = localDateKey(atMs);
  const sessions = await getDb().cashSessions.toArray();
  const session = sessions.find((s) => s.localDate === date);
  if (session && session.closedAt != null) {
    throw new Error(CASH_ERRORS.dayClosed);
  }
}
