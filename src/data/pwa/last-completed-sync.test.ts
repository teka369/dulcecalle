import { describe, expect, it } from "vitest";
import {
  LAST_COMPLETED_SYNC_KEY,
  readLastCompletedSync,
  writeLastCompletedSync,
  type LastCompletedSyncStorage,
} from "./last-completed-sync";

function memory(): LastCompletedSyncStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("last completed sync clock", () => {
  it("is empty until a cycle is recorded", () => {
    const storage = memory();
    expect(readLastCompletedSync(A, storage)).toBeNull();
    expect(readLastCompletedSync(B, storage)).toBeNull();
  });

  it("keeps each business apart and survives a new read", () => {
    const storage = memory();
    writeLastCompletedSync(A, 1_700_000_000_000, storage);
    writeLastCompletedSync(B, 1_700_000_100_000, storage);
    expect(readLastCompletedSync(A, storage)).toBe(1_700_000_000_000);
    expect(readLastCompletedSync(B, storage)).toBe(1_700_000_100_000);
    const raw = storage.getItem(LAST_COMPLETED_SYNC_KEY);
    expect(raw).toContain(A);
    expect(raw).toContain(B);
    expect(readLastCompletedSync(A, storage)).not.toBe(readLastCompletedSync(B, storage));
  });

  it("ignores corrupt values without throwing", () => {
    const storage = memory();
    storage.setItem(LAST_COMPLETED_SYNC_KEY, "{");
    expect(readLastCompletedSync(A, storage)).toBeNull();
    storage.setItem(LAST_COMPLETED_SYNC_KEY, JSON.stringify({ [A]: "ayer" }));
    expect(readLastCompletedSync(A, storage)).toBeNull();
  });
});
