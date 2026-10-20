jest.mock("bcrypt", () => ({
  hash: async () => "DUMMY",
  compare: async (pin: string, hash: string) => hash === `hash:${pin}`,
}));

import { Logger } from "@nestjs/common";
import { CustomerAccessService } from "./customer-access.service";
import type { PortalLoginThrottle } from "./portal-throttle";

/**
 * loop/v1 #6: guesses against ONE customer from many IPs (each under its own
 * per-IP limits) get a progressive delay and an alert log. Never a lock: the
 * real PIN still logs in, and a success clears the counter.
 */
const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ROW = { id: "cust-1", businessId: BIZ, code: "DC-0001", name: "Rosa", debt: 0n, pinHash: "hash:482913", business: { timezone: "America/Bogota", name: "T" } };

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
  const prisma = { customer: { findMany: jest.fn(async (a: { where: { code: string } }) => (a.where.code === ROW.code ? [ROW] : [])) } };
  const sessions = { issue: async () => ({ accessToken: "a", refreshToken: "r" }) };
  const svc = new CustomerAccessService(prisma as never, {} as never, {} as never, sessions as never, throttle as unknown as PortalLoginThrottle);
  const sleeps: number[] = [];
  (svc as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async (ms: number) => void sleeps.push(ms);
  return { svc, sleeps, counts };
}
const attempt = (svc: CustomerAccessService, pin: string, ip: string, code = "DC-0001") =>
  svc.login(code, pin, undefined, ip).then(() => "ok", (e: { code?: string }) => e.code ?? "error");

describe("portal per-customer soft cap", () => {
  it("many IPs failing on one customer: progressive delay + alert, never RATE_LIMIT/lock; real PIN still works and resets", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { svc, sleeps, counts } = setup();
    const results: string[] = [];
    for (let i = 0; i < 30; i++) results.push(await attempt(svc, "000000", `203.0.113.${i + 1}`));
    expect(new Set(results)).toEqual(new Set(["UNAUTHORIZED"]));
    // No delay for the first 10 failures, then growing, capped.
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps[0]).toBeGreaterThan(0);
    for (let i = 1; i < sleeps.length; i++) expect(sleeps[i]).toBeGreaterThanOrEqual(sleeps[i - 1]);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(4000);
    expect(warn.mock.calls.some((c) => /many failed PINs/i.test(String(c[0])))).toBe(true);
    // Real owner, from yet another IP: delayed but NOT blocked; counter reset.
    expect(await attempt(svc, "482913", "198.51.100.7")).toBe("ok");
    expect([...counts.values()].every((v) => v === 0)).toBe(true);
    sleeps.length = 0;
    expect(await attempt(svc, "000000", "198.51.100.8")).toBe("UNAUTHORIZED");
    expect(sleeps).toEqual([]);
    warn.mockRestore();
  });

  it("timing reveals nothing: an unknown code and a real code get the same delay schedule (keyed by the typed code)", async () => {
    const real = setup();
    const ghost = setup();
    for (let i = 0; i < 15; i++) {
      expect(await attempt(real.svc, "000000", `203.0.113.${i + 1}`, "DC-0001")).toBe("UNAUTHORIZED");
      expect(await attempt(ghost.svc, "000000", `203.0.113.${i + 1}`, "DC-9999")).toBe("UNAUTHORIZED");
    }
    expect(real.sleeps.length).toBeGreaterThan(0);
    expect(ghost.sleeps).toEqual(real.sleeps);
    // Same typed code, different spelling → same counter.
    expect([...ghost.counts.keys()]).toEqual(["code:DC-9999"]);
    expect(await attempt(ghost.svc, "000000", "203.0.113.200", " dc-9999 ")).toBe("UNAUTHORIZED");
    expect(ghost.counts.get("code:DC-9999")).toBe(16);
  });
});
