/**
 * Migration 20261007160000_cash_one_open_guard is self-protecting:
 * with open duplicates it aborts with MULTIPLE_OPEN_CASH_SESSIONS and leaves
 * data intact; without them it creates the partial unique index.
 * Runs only against the local embedded Postgres.
 */
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations");
const GUARD = "20261007160000_cash_one_open_guard";
const DIAGNOSTIC = path.join(__dirname, "..", "ops", "detect-multiple-open-cash-sessions.sql");

function sql(name: string) {
  return fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
}

const before = fs
  .readdirSync(MIGRATIONS)
  .filter((d) => /^\d{14}_/.test(d) && d < GUARD)
  .sort();

describe("cash one-open guard migration", () => {
  let pg: PgHandle | null = null;
  // The repo's minimal "pg" typings only expose query(text); widen locally.
  type Rows = { rows: Record<string, unknown>[]; rowCount: number | null };
  type Db = { query(text: string, values?: unknown[]): Promise<Rows>; end(): Promise<void> };
  let db: Db;

  beforeAll(async () => {
    pg = await startLocalPostgres();
    const u = new URL(pg.url);
    const client = new Client({
      host: u.hostname,
      port: Number(u.port),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.slice(1),
    });
    await client.connect();
    db = client as unknown as Db;
  }, 180000);

  afterAll(async () => {
    await db?.end();
    pg?.stop();
  });

  async function freshSchema(name: string) {
    await db.query(`DROP SCHEMA IF EXISTS ${name} CASCADE; CREATE SCHEMA ${name}; SET search_path TO ${name};`);
    for (const m of before) await db.query(sql(m));
  }

  async function seedSession(biz: string, day: string, closed: boolean) {
    await db.query(
      `INSERT INTO cash_sessions (id, business_id, local_date, opened_at, closed_at, opening_float)
       VALUES ($1, $2, $3, now(), $4, 0)`,
      [randomUUID(), biz, day, closed ? new Date() : null],
    );
  }

  async function business() {
    const id = randomUUID();
    await db.query(`INSERT INTO businesses (id, name) VALUES ($1, 'B')`, [id]);
    return id;
  }

  async function snapshot() {
    const r = await db.query(
      `SELECT id, business_id, local_date, closed_at FROM cash_sessions ORDER BY id`,
    );
    return r.rows;
  }

  async function indexExists() {
    const r = await db.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
       AND indexname = 'cash_sessions_one_open_per_business'`,
    );
    return r.rowCount === 1;
  }

  it("aborts with a clear message and touches nothing when open duplicates exist", async () => {
    await freshSchema("mig_dupes");
    const dup1 = await business();
    const dup2 = await business();
    const ok = await business();
    await seedSession(dup1, "2026-10-12", false);
    await seedSession(dup1, "2026-10-13", false);
    await seedSession(dup2, "2026-10-10", false);
    await seedSession(dup2, "2026-10-11", false);
    await seedSession(ok, "2026-10-12", true);
    await seedSession(ok, "2026-10-13", false);

    const diag = await db.query(fs.readFileSync(DIAGNOSTIC, "utf8"));
    expect(diag.rows.map((r) => r.business_id).sort()).toEqual([dup1, dup2].sort());

    const pre = await snapshot();
    await db.query("BEGIN");
    await expect(db.query(sql(GUARD))).rejects.toThrow(
      /MULTIPLE_OPEN_CASH_SESSIONS: 2 business\(es\) still have more than one open cash session/,
    );
    await db.query("ROLLBACK");
    expect(await snapshot()).toEqual(pre);
    expect(await indexExists()).toBe(false);
  });

  it("creates the partial unique index when there are no open duplicates", async () => {
    await freshSchema("mig_clean");
    const biz = await business();
    await seedSession(biz, "2026-10-12", true);
    await seedSession(biz, "2026-10-13", false);
    expect((await db.query(fs.readFileSync(DIAGNOSTIC, "utf8"))).rowCount).toBe(0);

    await db.query(sql(GUARD));
    expect(await indexExists()).toBe(true);
    await expect(seedSession(biz, "2026-10-14", false)).rejects.toMatchObject({ code: "23505" });
    await seedSession(biz, "2026-10-14", true);
  });
});
