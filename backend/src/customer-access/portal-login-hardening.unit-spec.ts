const compares: string[] = [];
jest.mock("bcrypt", () => ({
  hash: async () => "DUMMY",
  compare: async (pin: string, hash: string) => {
    compares.push(hash);
    return hash === `hash:${pin}`;
  },
}));

import { CustomerAccessService } from "./customer-access.service";
import type { PortalLoginThrottle } from "./portal-throttle";

/** loop/v1 portal hardening: one bcrypt per attempt; limits per IP(+code), never a lockout others can trigger. */
type Row = { id: string; businessId: string; code: string; name: string; debt: bigint; pinHash: string; business: { timezone: string; name: string } };
const B1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const B3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const row = (id: string, biz: string, pin: string): Row => ({ id, businessId: biz, code: "DC-0001", name: id, debt: 0n, pinHash: `hash:${pin}`, business: { timezone: "America/Bogota", name: `Tienda ${biz.slice(-1)}` } });

function fakeThrottle() {
  const counts = new Map<string, number>();
  const t = {
    keys: [] as string[],
    async take(key: string, policy?: { freeAttempts: number }) {
      t.keys.push(key);
      const free = policy?.freeAttempts ?? 5;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n > free ? "cooled" : "ok";
    },
    async reset(key: string) {
      counts.delete(key);
    },
  };
  return t;
}

function service(rows: Row[]) {
  const prisma = {
    customer: {
      findMany: jest.fn(async (args: { where: { businessId?: string; code: string }; take?: number }) => {
        const r = rows.filter((x) => x.code === args.where.code && (!args.where.businessId || x.businessId === args.where.businessId));
        return args.take ? r.slice(0, args.take) : r;
      }),
    },
  };
  const sessions = { issue: async () => ({ accessToken: "a", refreshToken: "r" }) };
  const throttle = fakeThrottle();
  const svc = new CustomerAccessService(prisma as never, {} as never, {} as never, sessions as never, throttle as unknown as PortalLoginThrottle);
  return { svc, throttle };
}

const login = (svc: CustomerAccessService, code: string, pin: string, biz?: string, ip?: string, store?: string) =>
  (svc.login as (...a: unknown[]) => Promise<unknown>)(code, pin, biz, ip, store).then(
    () => "ok",
    (e: { code?: string }) => e.code ?? "error",
  );

describe("portal login hardening", () => {
  beforeEach(() => (compares.length = 0));

  it("no businessId + the code exists in 3 stores → exactly one bcrypt compare (dummy), generic 401", async () => {
    const { svc } = service([row("a", B1, "111111"), row("b", B2, "222222"), row("c", B3, "333333")]);
    expect(await login(svc, "DC-1", "222222", undefined, "203.0.113.5")).toBe("UNAUTHORIZED");
    expect(compares).toEqual(["DUMMY"]);
  });

  it("multi-store + store hint → exactly one compare: real hash for the matched store, dummy otherwise", async () => {
    const { svc } = service([row("a", B1, "111111"), row("b", B2, "222222"), row("c", B3, "333333")]);
    expect(await login(svc, "DC-1", "222222", undefined, "203.0.113.5", "tienda 2")).toBe("ok");
    expect(compares).toEqual(["hash:222222"]);
    compares.length = 0;
    expect(await login(svc, "DC-1", "222222", undefined, "203.0.113.5", "tienda 9")).toBe("UNAUTHORIZED");
    expect(compares).toEqual(["DUMMY"]);
  });

  it("unknown code → one dummy compare; single candidate → one real compare", async () => {
    const { svc } = service([row("a", B1, "111111")]);
    expect(await login(svc, "DC-9", "111111", undefined, "203.0.113.5")).toBe("UNAUTHORIZED");
    expect(compares).toEqual(["DUMMY"]);
    compares.length = 0;
    expect(await login(svc, "DC-1", "111111", undefined, "203.0.113.5")).toBe("ok");
    expect(compares).toEqual(["hash:111111"]);
  });

  it("a third party failing from its IP cannot lock the customer out of their own IP", async () => {
    const { svc } = service([row("a", B1, "111111")]);
    for (let i = 0; i < 10; i++) await login(svc, "DC-1", "000000", B1, "203.0.113.5");
    expect(await login(svc, "DC-1", "111111", B1, "203.0.113.5")).toBe("RATE_LIMIT");
    expect(await login(svc, "DC-1", "111111", B1, "198.51.100.7")).toBe("ok");
  });

  it("one IP walking sequential codes is cooled after 20 guesses", async () => {
    const { svc } = service([]);
    const out: string[] = [];
    for (let i = 1; i <= 25; i++) out.push(await login(svc, `DC-${i}`, "000000", B1, "203.0.113.9"));
    expect(out.slice(0, 20).every((r) => r === "UNAUTHORIZED")).toBe(true);
    expect(out.slice(20).every((r) => r === "RATE_LIMIT")).toBe(true);
  });

  it("private/proxy IP (trust proxy wrong): degrades to per-code limits, no global per-IP bucket", async () => {
    const { svc, throttle } = service([row("a", B1, "111111")]);
    for (let i = 0; i < 5; i++) expect(await login(svc, "DC-1", "000000", B1, "10.0.0.3")).toBe("UNAUTHORIZED");
    expect(await login(svc, "DC-1", "111111", B1, "10.0.0.3")).toBe("RATE_LIMIT");
    for (let i = 2; i <= 30; i++) expect(await login(svc, `DC-${i}`, "000000", B1, "10.0.0.3")).toBe("UNAUTHORIZED");
    expect(throttle.keys.some((k) => k.startsWith("ip:"))).toBe(false);
  });
});
