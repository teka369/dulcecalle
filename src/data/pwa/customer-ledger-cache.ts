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

export async function loadCachedCustomerLedger(): Promise<CachedCustomerLedger> {
  const customerId = requireCustomerId();
  const db = getLocalDb();
  try {
    const ledger = await getCustomerApi().ledger();
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
