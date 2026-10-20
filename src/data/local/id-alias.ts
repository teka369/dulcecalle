/**
 * loop/v1: after sync, a client-minted entity id (product/customer/supplier)
 * is remapped to the server id and the local row is deleted. A URL, tab or
 * cached state that still holds the old local id must resolve to the server
 * id instead of «No encontramos». Kept in localStorage (per business), with
 * an in-memory fallback; bounded.
 */
const KEY = (businessId: string) => `dulcecalle:id-alias:${businessId}`;
const MAX = 500;
const memory = new Map<string, Record<string, string>>();

function load(businessId: string): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY(businessId));
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {
    // fall through to memory
  }
  return memory.get(businessId) ?? {};
}

export function recordIdAlias(businessId: string, localId: string, serverId: string): void {
  if (localId === serverId) return;
  const map = load(businessId);
  map[localId] = serverId;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete map[k];
  memory.set(businessId, map);
  try {
    globalThis.localStorage?.setItem(KEY(businessId), JSON.stringify(map));
  } catch {
    // memory copy is enough for this session
  }
}

/** Server id for a remapped local id; the id itself otherwise. */
export function resolveIdAlias(businessId: string, id: string): string {
  return load(businessId)[id] ?? id;
}
