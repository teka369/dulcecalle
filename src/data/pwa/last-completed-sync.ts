/**
 * UI clock only: when this device last finished a sync cycle with nothing
 * left to send for one business. Not accounting. Not the outbox. Not a backup.
 * localStorage so a reload keeps it, and so two shops never share a time.
 */
export const LAST_COMPLETED_SYNC_KEY = "dulcecalle.sync.lastCompleted";

export type LastCompletedSyncStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const memory = new Map<string, string>();

const memoryStorage: LastCompletedSyncStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
  },
  removeItem: (key) => {
    memory.delete(key);
  },
};

export function defaultLastCompletedSyncStorage(): LastCompletedSyncStorage {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode or a test runtime without localStorage */
  }
  return memoryStorage;
}

function readMap(storage: LastCompletedSyncStorage): Record<string, unknown> {
  try {
    const raw = storage.getItem(LAST_COMPLETED_SYNC_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function readLastCompletedSync(
  businessId: string,
  storage: LastCompletedSyncStorage = defaultLastCompletedSyncStorage(),
): number | null {
  if (!businessId) return null;
  const value = readMap(storage)[businessId];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function writeLastCompletedSync(
  businessId: string,
  at: number,
  storage: LastCompletedSyncStorage = defaultLastCompletedSyncStorage(),
): void {
  if (!businessId || !Number.isFinite(at) || at <= 0) return;
  const map = readMap(storage);
  map[businessId] = at;
  storage.setItem(LAST_COMPLETED_SYNC_KEY, JSON.stringify(map));
}

/** Test-only: drop the UI clock. Does not touch the outbox or session. */
export function __clearLastCompletedSyncForTests(
  storage: LastCompletedSyncStorage = defaultLastCompletedSyncStorage(),
): void {
  storage.removeItem(LAST_COMPLETED_SYNC_KEY);
  memory.clear();
}
