/**
 * M6.10 — Customer portal ledger read cache (read-only).
 *
 * Online: GET /customer/me/ledger → store the whole snapshot keyed by
 * customerId → render server data. Offline (NetworkError only): serve the
 * last snapshot of the same customerId, or rethrow when never cached.
 * HTTP errors are never converted into cache hits. The portal has no
 * outbox; there is nothing to sync, only to display as historical data.
 */
import { NetworkError } from "../errors";
import { getCustomerApi, type CustomerLedger } from "../http/customer-api";
import { getCustomerAuthSession } from "../http/customer-session";
import { getLocalDb } from "../local/db";

export type CachedCustomerLedger = {
  ledger: CustomerLedger;
  source: "server" | "cache";
  capturedAt: number;
};

function requireCustomerId(): string {
  const id = getCustomerAuthSession().customer?.id;
  if (!id) throw new Error("Inicia sesión.");
  return id;
}

/** Thrown when the server ledger does not belong to the signed-in customer. Never cached. */
export const FOREIGN_LEDGER_MESSAGE = "No se pudo cargar.";

export class ForeignLedgerError extends Error {
  constructor() {
    super(FOREIGN_LEDGER_MESSAGE);
    this.name = "ForeignLedgerError";
  }
}

/**
 * Ownership check (same rule as the portal's ownLedger): the response must be
 * for the session customer, and the session must not have switched while the
 * request was in flight.
 */
export function ledgerBelongsToSession(ledger: CustomerLedger | null | undefined, customerId: string): boolean {
  return Boolean(ledger) && ledger!.customer?.id === customerId && getCustomerAuthSession().customer?.id === customerId;
}

export async function loadCachedCustomerLedger(): Promise<CachedCustomerLedger> {
  const customerId = requireCustomerId();
  const db = getLocalDb();
  try {
    const ledger = await getCustomerApi().ledger();
    // Privacy 4a: verify ownership BEFORE writing to Dexie; foreign data is
    // neither cached nor returned (and never falls back to cache).
    if (!ledgerBelongsToSession(ledger, customerId)) throw new ForeignLedgerError();
    const capturedAt = Date.now();
    await db.customerLedgers.put({ customerId, ledger, capturedAt });
    return { ledger, source: "server", capturedAt };
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    const cached = await db.customerLedgers.get(customerId);
    if (!cached) throw e;
    return { ledger: cached.ledger, source: "cache", capturedAt: cached.capturedAt };
  }
}
