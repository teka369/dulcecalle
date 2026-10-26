jest.mock("bcrypt", () => ({
  hash: async () => "DUMMY",
  compare: async (pin: string, hash: string) => hash === `hash:${pin}`,
}));

import { Logger } from "@nestjs/common";
import { CustomerAccessService } from "./customer-access.service";
import type { PortalLoginThrottle } from "./portal-throttle";

/**
 * loop/v1 portal soft cap (Jefecito, 2026-10-20): the progressive delay is
 * counted ONLY per IP+code and per store+code (when the store is given), by
 * the TYPED code before any lookup — so a flood on a shared code like DC-0001
 * from one IP never slows other IPs. The global per-code counter only logs.
 */
const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ROW = { id: "cust-1", businessId: BIZ, code: "DC-0001", name: "Rosa", debt: 0n, pinHash: "hash:482913", business: { timezone: "America/Bogota", name: "Tienda Norte" } };

function setup() {
  const counts = new Map<string, number>();
  const throttle = {
    async take() {
      return "ok" as const;
    },
    async reset(key: string) {
      counts.delete(key);
    },
    async peek(key: string) {
      return counts.get(key) ?? 0;
    },
    async bump(key: string) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
  };
  const prisma = {
    customer: {
      findMany: jest.fn(async (a: { where: { code: string; businessId?: string } }) =>
        a.where.code === ROW.code && (!a.where.businessId || a.where.businessId === BIZ) ? [ROW] : [],
      ),
    },
  };
  const sessions = { issue: async () => ({ accessToken: "a", refreshToken: "r" }) };
  const svc = new CustomerAccessService(prisma as never, {} as never, {} as never, sessions as never, throttle as unknown as PortalLoginThrottle);
  const sleeps: number[] = [];
  (svc as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async (ms: number) => void sleeps.push(ms);
  return { svc, sleeps, counts };
}
type Opts = { code?: string; biz?: string; store?: string };
const attempt = (svc: CustomerAccessService, pin: string, ip: string, o: Opts = {}) =>
  svc.login(o.code ?? "DC-0001", pin, o.biz, ip, o.store).then(() => "ok", (e: { code?: string }) => e.code ?? "error");

describe("portal soft cap (per IP+code / store+code; global = alert only)", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it("flooding DC-0001 from IP A slows IP A only; IP B (no store) gets no delay; global alert is logged", async () => {
    const { svc, sleeps } = setup();
    for (let i = 0; i < 15; i++) expect(await attempt(svc, "000000", "203.0.113.1")).toBe("UNAUTHORIZED");
    expect(sleeps.length).toBe(5);
    for (let i = 1; i < sleeps.length; i++) expect(sleeps[i]).toBeGreaterThanOrEqual(sleeps[i - 1]);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(4000);
    expect(warn.mock.calls.some((c) => /many failed PINs/i.test(String(c[0])))).toBe(true);
    sleeps.length = 0;
    expect(await attempt(svc, "482913", "198.51.100.9")).toBe("ok");
    expect(await attempt(svc, "000000", "198.51.100.10")).toBe("UNAUTHORIZED");
    expect(sleeps).toEqual([]);
  });

  it("with the store given (businessId or store field), store+code is delayed from any IP", async () => {
    const { svc, sleeps } = setup();
    for (let i = 0; i < 12; i++) await attempt(svc, "000000", `203.0.113.${i + 1}`, { biz: BIZ });
    expect(sleeps.length).toBe(2);
    sleeps.length = 0;
    const s2 = setup();
    for (let i = 0; i < 12; i++) await attempt(s2.svc, "000000", `203.0.113.${i + 1}`, { store: "Tienda Norte" });
    expect(s2.sleeps.length).toBe(2);
    // Same code, no store, fresh IP: not delayed by the store counter.
    s2.sleeps.length = 0;
    await attempt(s2.svc, "000000", "198.51.100.77");
    expect(s2.sleeps).toEqual([]);
  });

  it("unknown vs real code: identical delay schedule within the same keys (counted by typed code, before lookup)", async () => {
    const real = setup();
    const ghost = setup();
    for (let i = 0; i < 15; i++) {
      await attempt(real.svc, "000000", "203.0.113.5", { code: "DC-0001" });
      await attempt(ghost.svc, "000000", "203.0.113.5", { code: "DC-9999" });
    }
    expect(real.sleeps.length).toBeGreaterThan(0);
    expect(ghost.sleeps).toEqual(real.sleeps);
  });

  it("never locks: the right PIN still works after a flood and resets the delay", async () => {
    const { svc, sleeps } = setup();
    for (let i = 0; i < 20; i++) await attempt(svc, "000000", "203.0.113.1");
    expect(await attempt(svc, "482913", "203.0.113.1")).toBe("ok");
    sleeps.length = 0;
    await attempt(svc, "000000", "203.0.113.1");
    expect(sleeps).toEqual([]);
  });
});
