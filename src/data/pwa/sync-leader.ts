/**
 * Cross-tab outbox leadership (loop/v1 tab lock).
 *
 * All tabs of the origin share one IndexedDB outbox, so exactly ONE tab may
 * replay it at a time, otherwise two tabs POST the same op concurrently and
 * a tab whose (empty) flush ends early refreshes before the data landed.
 *
 * - Web Locks: `navigator.locks.request(name, { ifAvailable: true })`, the
 *   lock is released by the browser even if the tab dies mid-sync.
 * - Fallback (no Web Locks): a localStorage lease {owner, until}, renewed
 *   while running, taken over only once expired.
 * - No storage either: run (single-tab behaviour, idempotency still holds).
 *
 * The leader broadcasts its progress events and a final "complete" on
 * BroadcastChannel `dulcecalle:sync-complete`; followers never flush on their
 * own `online`, they refresh when the leader says it's done.
 */

export const SYNC_CHANNEL = "dulcecalle:sync-complete";
export const LEASE_TTL_MS = 15_000;
const LEASE_RENEW_MS = 5_000;

export type LeaderResult<T> = { leader: true; value: T } | { leader: false };

type LockManagerLike = {
  request: (
    name: string,
    options: { ifAvailable: boolean; mode?: "exclusive" },
    cb: (lock: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LeaderEnv = {
  locks?: LockManagerLike | null;
  storage?: StorageLike | null;
  now?: () => number;
  tabId?: string;
};

let defaultTabId: string | null = null;
function tabIdOf(env: LeaderEnv): string {
  if (env.tabId) return env.tabId;
  defaultTabId ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return defaultTabId;
}

function browserEnv(): LeaderEnv {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManagerLike }) : undefined;
  let storage: StorageLike | null = null;
  try {
    storage = typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    storage = null;
  }
  return { locks: nav?.locks ?? null, storage };
}

export function lockName(businessId: string): string {
  return `dulcecalle:outbox-sync:${businessId}`;
}

/** Run `fn` only if this tab becomes the outbox leader for `businessId`; otherwise skip. */
export async function runAsLeader<T>(
  businessId: string,
  fn: () => Promise<T>,
  env: LeaderEnv = browserEnv(),
): Promise<LeaderResult<T>> {
  const name = lockName(businessId);
  if (env.locks) {
    let out: LeaderResult<T> = { leader: false };
    await env.locks.request(name, { ifAvailable: true, mode: "exclusive" }, async (lock) => {
      if (!lock) return;
      out = { leader: true, value: await fn() };
    });
    return out;
  }
  if (env.storage) return runWithLease(name, fn, env.storage, env.now ?? Date.now, tabIdOf(env));
  return { leader: true, value: await fn() };
}

type Lease = { owner: string; until: number };
function readLease(storage: StorageLike, key: string): Lease | null {
  try {
    const raw = storage.getItem(key);
    const v = raw ? (JSON.parse(raw) as Lease) : null;
    return v && typeof v.owner === "string" && typeof v.until === "number" ? v : null;
  } catch {
    return null;
  }
}

async function runWithLease<T>(
  name: string,
  fn: () => Promise<T>,
  storage: StorageLike,
  now: () => number,
  owner: string,
): Promise<LeaderResult<T>> {
  const key = `${name}:lease`;
  const held = readLease(storage, key);
  if (held && held.owner !== owner && held.until > now()) return { leader: false };
  storage.setItem(key, JSON.stringify({ owner, until: now() + LEASE_TTL_MS }));
  // Two tabs can write in the same instant: let the last write win, then check.
  await new Promise((r) => setTimeout(r, 30));
  if (readLease(storage, key)?.owner !== owner) return { leader: false };
  const renew = setInterval(() => {
    if (readLease(storage, key)?.owner === owner) {
      storage.setItem(key, JSON.stringify({ owner, until: now() + LEASE_TTL_MS }));
    }
  }, LEASE_RENEW_MS);
  try {
    return { leader: true, value: await fn() };
  } finally {
    clearInterval(renew);
    if (readLease(storage, key)?.owner === owner) storage.removeItem(key);
  }
}

export type SyncBroadcast =
  | { type: "progress"; businessId: string; detail: Record<string, unknown> }
  | { type: "complete"; businessId: string };

type ChannelLike = { postMessage: (m: unknown) => void; close?: () => void; onmessage: ((e: { data: unknown }) => void) | null };

export function openSyncChannel(): ChannelLike | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(SYNC_CHANNEL) as unknown as ChannelLike;
  } catch {
    return null;
  }
}
