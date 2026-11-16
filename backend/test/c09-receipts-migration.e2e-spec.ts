/**
 * C09-PR2 — migration 20261109050000_c09_receipts (G-MIG): additive (new
 * enum, tables and trigger only); existing rows untouched; no backfill.
 * Embedded Postgres only, fictitious data.
 */
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations");
const PR2 = "20261109050000_c09_receipts";
const sql = (name: string) => fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
const before = fs
  .readdirSync(MIGRATIONS)
  .filter((d) => /^\d{14}_/.test(d) && d < PR2)
  .sort();

describe("C09-PR2 receipts migration", () => {
  let pg: PgHandle | null = null;
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

  it("adds receipts on a schema with data, touches no existing row and backfills nothing", async () => {
    await db.query(`DROP SCHEMA IF EXISTS c09r CASCADE; CREATE SCHEMA c09r; SET search_path TO c09r;`);
    for (const m of before) await db.query(sql(m));
    const biz = randomUUID();
    await db.query(`INSERT INTO businesses (id, name) VALUES ($1, 'B')`, [biz]);
    await db.query(
      `INSERT INTO sales (id, business_id, payment_kind, method, sale_total, amount_received, credit, occurred_on, number)
       VALUES ($1, $2, 'paid', 'Efectivo', 1000, 1000, 0, '2026-10-01', 1)`,
      [randomUUID(), biz],
    );
    const pre = await db.query(`SELECT row_to_json(s)::text j FROM sales s ORDER BY id`);
    await db.query(sql(PR2));
    expect((await db.query(`SELECT row_to_json(s)::text j FROM sales s ORDER BY id`)).rows).toEqual(pre.rows);
    expect((await db.query(`SELECT count(*)::int n FROM receipts`)).rows[0]!.n).toBe(0);
    const trig = await db.query(`SELECT tgname FROM pg_trigger WHERE tgname = 'receipts_insert_only'`);
    expect(trig.rowCount).toBe(1);
  });
});
