import { describe, expect, it, vi } from "vitest";

/**
 * Minimal per-instance hook harness (no DOM lib in this repo): each mount gets
 * its own state/ref slots; effects run once on mount. Enough to prove the tray
 * and /sincronizacion can both be mounted and both leave `loading`.
 */
type Inst = { slots: unknown[]; i: number; effects: Array<() => unknown>; rerender: () => void };
let current: Inst | null = null;

vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  const slot = <T,>(init: () => T): [T, (v: T) => void] => {
    const inst = current!;
    const idx = inst.i++;
    if (!(idx in inst.slots)) inst.slots[idx] = init();
    return [inst.slots[idx] as T, (v: T) => {
      inst.slots[idx] = v;
    }];
  };
  return {
    ...actual,
    useState: <T,>(init: T) => slot(() => init),
    useRef: <T,>(init: T) => slot(() => ({ current: init }))[0],
    useCallback: <T,>(fn: T) => fn,
    useEffect: (fn: () => unknown) => {
      current!.effects.push(fn);
    },
  };
});

const listEnrichedTray = vi.fn(async () => {
  await new Promise((r) => setTimeout(r, 5));
  return [];
});
vi.mock("@/data/pwa/sync-tray", async (orig) => ({
  ...(await orig<object>()),
  listEnrichedTray,
}));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => ({ businessId: "b1" }) }));
vi.mock("@/store/syncStore", () => ({ syncStore: { subscribe: () => () => undefined } }));

describe("useSyncItems per-instance loading (P6 tester FAIL 1)", () => {
  it("two simultaneous mounts both exit loading", async () => {
    const mod = await import("./sync-items");
    function mount() {
      const inst: Inst = { slots: [], i: 0, effects: [], rerender: () => undefined };
      const render = () => {
        inst.i = 0;
        current = inst;
        const out = mod.useSyncItems();
        current = null;
        return out;
      };
      render();
      return { inst, render };
    }
    const a = mount();
    const b = mount();
    for (const m of [a, b]) for (const e of m.inst.effects) e();
    await new Promise((r) => setTimeout(r, 30));
    expect(a.render().loading).toBe(false);
    expect(b.render().loading).toBe(false);
    expect(listEnrichedTray).toHaveBeenCalledTimes(2);
  });
});
