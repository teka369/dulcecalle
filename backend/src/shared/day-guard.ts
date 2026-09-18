import { AppError, ERROR_CODES, MESSAGES } from "./errors";

type SessionReader = {
  cashSession: {
    findUnique: (args: {
      where: { businessId_localDate: { businessId: string; localDate: Date } };
    }) => Promise<{ closedAt: Date | null } | null>;
  };
};

type TxLock = SessionReader & {
  $queryRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

/** Closed-day lock. Exempt: product birth, initial debts (not called here). */
export async function assertDayEditable(
  db: SessionReader,
  businessId: string,
  occurredOn: Date,
): Promise<void> {
  const session = await db.cashSession.findUnique({
    where: { businessId_localDate: { businessId, localDate: occurredOn } },
  });
  if (session?.closedAt) {
    throw new AppError(ERROR_CODES.CLOSED_DAY, MESSAGES.closedDay);
  }
}

/**
 * Serialize economic writes for one business and re-check closed-day
 * against a locked session row. Call inside the DB transaction.
 */
export async function lockAndAssertDayEditable(
  tx: TxLock,
  businessId: string,
  occurredOn: Date,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId}))`;
  const rows = (await tx.$queryRaw`
    SELECT closed_at
    FROM cash_sessions
    WHERE business_id = ${businessId}::uuid
      AND local_date = ${occurredOn}
    FOR UPDATE
  `) as Array<{ closed_at: Date | null }>;
  if (rows[0]?.closed_at) {
    throw new AppError(ERROR_CODES.CLOSED_DAY, MESSAGES.closedDay);
  }
}
