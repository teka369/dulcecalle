import { describe, expect, it } from "vitest";
import { LEASE_TTL_MS, lockName, runAsLeader } from "./sync-leader";

/** Minimal exclusive Web Locks with ifAvailable (what Chromium/Safari/Firefox ship). */
function fakeLocks() {
  const held = new Set<string>();
  return {
    held,
    async request(name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<unknown>) {
      if (held.has(name)) return cb(null);
      held.add(name);
      try {
        return await cb({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}
function fakeStorage() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const BIZ = "00000000-0000-4000-8000-0000000000b1";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("outbox sync leader (Web Locks)", () => {
  it("two tabs at once: exactly one runs the sync, the other is a follower", async () => {
    const locks = fakeLocks();
    const gate = deferred();
    let runs = 0;
    const job = async () => {
      runs += 1;
      await gate.promise;
      return "synced";
    };
    const a = runAsLeader(BIZ, job, { locks, tabId: "A" });
    const b = await runAsLeader(BIZ, job, { locks, tabId: "B" });
    expect(b).toEqual({ leader: false });
    gate.resolve();
    expect(await a).toEqual({ leader: true, value: "synced" });
    expect(runs).toBe(1);
    expect(locks.held.size).toBe(0);
  });

  it("lock is per business and released after the run (also when the sync throws)", async () => {
    const locks = fakeLocks();
    await expect(runAsLeader(BIZ, async () => { throw new Error("boom"); }, { locks })).rejects.toThrow("boom");
    expect(locks.held.size).toBe(0);
    expect(await runAsLeader(BIZ, async () => 1, { locks })).toEqual({ leader: true, value: 1 });
    expect(lockName(BIZ)).not.toBe(lockName("00000000-0000-4000-8000-0000000000b2"));
  });
});

describe("outbox sync leader (localStorage lease fallback, no Web Locks)", () => {
  it("only one tab holds the lease; the other skips; the lease is released at the end", async () => {
    const storage = fakeStorage();
    const gate = deferred();
    let runs = 0;
    const job = async () => {
      runs += 1;
      await gate.promise;
      return "ok";
    };
    const a = runAsLeader(BIZ, job, { locks: null, storage, tabId: "A" });
    await new Promise((r) => setTimeout(r, 50));
    expect(await runAsLeader(BIZ, job, { locks: null, storage, tabId: "B" })).toEqual({ leader: false });
    gate.resolve();
    expect(await a).toEqual({ leader: true, value: "ok" });
    expect(runs).toBe(1);
    expect(storage.m.size).toBe(0);
  });

  it("a lease left by a dead tab is taken over once expired, not before", async () => {
    const storage = fakeStorage();
    let t = 1_000_000;
    storage.setItem(`${lockName(BIZ)}:lease`, JSON.stringify({ owner: "dead", until: t + LEASE_TTL_MS }));
    expect(await runAsLeader(BIZ, async () => 1, { locks: null, storage, tabId: "B", now: () => t })).toEqual({ leader: false });
    t += LEASE_TTL_MS + 1;
    expect(await runAsLeader(BIZ, async () => 2, { locks: null, storage, tabId: "B", now: () => t })).toEqual({ leader: true, value: 2 });
  });

  it("two tabs writing the lease at the same moment: last writer wins, only one runs", async () => {
    const storage = fakeStorage();
    let runs = 0;
    const job = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 60));
      return 1;
    };
    const [a, b] = await Promise.all([
      runAsLeader(BIZ, job, { locks: null, storage, tabId: "A" }),
      runAsLeader(BIZ, job, { locks: null, storage, tabId: "B" }),
    ]);
    expect([a.leader, b.leader].filter(Boolean)).toHaveLength(1);
    expect(runs).toBe(1);
  });

  it("no Web Locks and no storage: runs (single-tab behaviour)", async () => {
    expect(await runAsLeader(BIZ, async () => 7, { locks: null, storage: null })).toEqual({ leader: true, value: 7 });
  });
});
