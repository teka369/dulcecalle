import { CashManagerService } from "./cash-manager.service";
import { CashService } from "./cash.service";

/** loop/v1 M5: GET /cash/sessions is paginated and uses a constant number of queries (no N+1). */
type Row = Record<string, unknown>;
function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((w) => match(row, w));
    if (k === "AND") return (cond as Row[]).every((w) => match(row, w));
    const v = row[k];
    if (cond === null) return v == null;
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("not" in c) return c.not === null ? v != null : v !== c.not;
      if ("gt" in c) return (v as Date) > (c.gt as Date);
      if ("lt" in c) return (v as Date) < (c.lt as Date);
      return false;
    }
    return v instanceof Date ? v.getTime() === (cond as Date).getTime() : v === cond;
  });
}
function sortBy(rows: Row[], orderBy?: Row | Row[]) {
  const keys = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
  return [...rows].sort((a, b) => {
    for (const o of keys) {
      const [k, dir] = Object.entries(o)[0] as [string, string];
      const x = a[k] as never, y = b[k] as never;
      if (x < y) return dir === "desc" ? 1 : -1;
      if (x > y) return dir === "desc" ? -1 : 1;
    }
    return 0;
  });
}
function world(nSessions: number) {
  const biz = "b";
  const sessions: Row[] = [];
  const moves: Row[] = [];
  for (let i = 0; i < nSessions; i++) {
    const id = `s${String(i).padStart(3, "0")}`;
    const open = i >= nSessions - 2;
    sessions.push({
      id, businessId: biz, localDate: new Date(Date.UTC(2026, 0, 1 + i)), openedAt: new Date(Date.UTC(2026, 0, 1 + i, 12)),
      closedAt: open ? null : new Date(Date.UTC(2026, 0, 1 + i, 23)), openingFloat: 1000n, carriedEfectivo: 0n,
      closingCount: open ? null : 1500n, expectedEfectivo: open ? null : 1500n, expectedNequi: open ? null : 0n,
      difference: open ? null : 0n, closeMode: open ? null : "counted", note: null,
    });
    moves.push({ id: `m${i}a`, businessId: biz, sessionId: id, pendingForSessionId: null, direction: "in", method: "Efectivo", amount: 500n, createdAt: new Date(Date.UTC(2026, 0, 1 + i, 13)) });
    moves.push({ id: `m${i}b`, businessId: biz, sessionId: id, pendingForSessionId: null, direction: "in", method: "Nequi", amount: 200n, createdAt: new Date(Date.UTC(2026, 0, 1 + i, 14)) });
  }
  moves.push({ id: "stamp", businessId: biz, sessionId: null, pendingForSessionId: sessions[nSessions - 2].id, direction: "out", method: "Efectivo", amount: 100n, createdAt: new Date() });
  let queries = 0;
  const q = <T>(v: T) => { queries++; return Promise.resolve(v); };
  const prisma = {
    cashSession: {
      findMany: ({ where, orderBy, take }: Row) => q(sortBy(sessions.filter((s) => match(s, where as Row)), orderBy as Row).slice(0, (take as number) ?? Infinity)),
      count: ({ where }: Row) => q(sessions.filter((s) => match(s, where as Row)).length),
    },
    cashMove: {
      findMany: ({ where, orderBy, select }: Row) => q(sortBy(moves.filter((m) => match(m, where as Row)), orderBy as Row).map((m) => select ? Object.fromEntries(Object.keys(select as Row).map((k) => [k, m[k]])) : m)),
      count: ({ where }: Row) => q(moves.filter((m) => match(m, where as Row)).length),
      findFirst: ({ where, orderBy }: Row) => q(sortBy(moves.filter((m) => match(m, where as Row)), orderBy as Row)[0] ?? null),
    },
  };
  const svc = new CashManagerService(prisma as never, new CashService(prisma as never));
  return { svc, ctx: { businessId: biz, timezone: "America/Bogota" } as never, reset: () => (queries = 0), count: () => queries };
}

const list = (w: ReturnType<typeof world>, ...a: unknown[]) => (w.svc as any).list(w.ctx, ...a) as Promise<Row[]>;

describe("GET /cash/sessions list (M5)", () => {
  it("issues the same number of queries for 3 and 30 sessions (no N+1)", async () => {
    const small = world(3); small.reset(); await small.svc.list(small.ctx);
    const big = world(30); big.reset(); const rows = await big.svc.list(big.ctx);
    expect(rows).toHaveLength(30);
    expect(big.count()).toBe(small.count());
    expect(big.count()).toBeLessThanOrEqual(6);
  });

  it("keeps the summary shape/values (open session expected computed, stamped → requiresCarry)", async () => {
    const w = world(4);
    const rows = (await w.svc.list(w.ctx)) as Row[];
    expect(rows.map((r) => r.id)).toEqual(["s003", "s002", "s001", "s000"]);
    const s2 = rows[1];
    expect(s2).toMatchObject({ moveCount: 2, expectedEfectivo: 1400, expectedNequi: 200, requiresCarry: true, canCountClose: false, hasLaterOpenSession: true, laterActivity: true });
    expect(rows[0]).toMatchObject({ expectedEfectivo: 1500, requiresCarry: false, canCountClose: true, hasLaterOpenSession: false });
    expect(rows[3]).toMatchObject({ expectedEfectivo: 1500, regularized: true, moveCount: 2 });
    expect((rows[3].lastMoveAt as Date).toISOString()).toBe("2026-01-01T14:00:00.000Z");
  });

  it("paginates: default limit 50, max 200, cursor continues after the given session", async () => {
    const w = world(260);
    expect(await w.svc.list(w.ctx)).toHaveLength(50);
    expect(await list(w, undefined, { limit: "1000" })).toHaveLength(200);
    const p1 = (await list(w, undefined, { limit: "2" })) as Row[];
    const p2 = (await list(w, undefined, { limit: "2", cursor: String(p1[1].id) })) as Row[];
    expect(p1.map((r) => r.id)).toEqual(["s259", "s258"]);
    expect(p2.map((r) => r.id)).toEqual(["s257", "s256"]);
    await expect(list(w, undefined, { limit: "abc" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
