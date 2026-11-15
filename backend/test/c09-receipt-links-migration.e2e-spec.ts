/**
 * C09-PR5 — migration 20261109080000_c09_receipt_links (G-MIG): additive (new
 * enum, tables and trigger only); existing rows untouched; no backfill.
 * Embedded Postgres only, fictitious data.
 */
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations");
const PR5 = "20261109080000_c09_receipt_links";
const sql = (name: string) => fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
const before = fs
  .readdirSync(MIGRATIONS)
  .filter((d) => /^\d{14}_/.test(d) && d < PR5)
  .sort();

describe("C09-PR5 receipt links migration", () => {
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

  it("adds receipt_links on a schema with data; receipts and acks untouched; token stored only as a sha256", async () => {
    await db.query(`DROP SCHEMA IF EXISTS c09l CASCADE; CREATE SCHEMA c09l; SET search_path TO c09l;`);
    for (const m of before) await db.query(sql(m));
    const biz = randomUUID();
    const rid = randomUUID();
    await db.query(`INSERT INTO businesses (id, name) VALUES ($1, 'B')`, [biz]);
    await db.query(
      `INSERT INTO receipts (id, business_id, customer_id, kind, source_type, source_id, number, verify_code, snapshot, content_hash)
       VALUES ($1, $2, $3, 'sale', 'sale', $4, 'DC-000001', '23456789AB', '{}', $5)`,
      [rid, biz, randomUUID(), randomUUID(), "a".repeat(64)],
    );
    await db.query(
      `INSERT INTO receipt_acknowledgements (id, business_id, customer_id, receipt_id, receipt_hash, kind, channel) VALUES ($1, $2, $3, $4, $5, 'acknowledged', 'portal')`,
      [randomUUID(), biz, randomUUID(), rid, "a".repeat(64)],
    );
    const pre = await db.query(
      `SELECT (SELECT json_agg(r ORDER BY id)::text FROM receipts r) rs, (SELECT json_agg(a ORDER BY id)::text FROM receipt_acknowledgements a) acks`,
    );
    await db.query(sql(PR5));
    expect(
      (await db.query(`SELECT (SELECT json_agg(r ORDER BY id)::text FROM receipts r) rs, (SELECT json_agg(a ORDER BY id)::text FROM receipt_acknowledgements a) acks`)).rows,
    ).toEqual(pre.rows);
    expect((await db.query(`SELECT count(*)::int n FROM receipt_links`)).rows[0]!.n).toBe(0);
    const ins = (hash: string, req: string) =>
      db.query(
        `INSERT INTO receipt_links (id, business_id, receipt_id, token_hash, expires_at, request_id, created_at) VALUES ($1, $2, $3, $4, now() + interval '48 hours', $5, now())`,
        [randomUUID(), biz, rid, hash, req],
      );
    await ins("b".repeat(64), "r1");
    await expect(ins("b".repeat(64), "r2")).rejects.toThrow(/token_hash_key/);
    await expect(ins("raw-token-not-a-hash", "r3")).rejects.toThrow(/token_hash_format/);
    await expect(ins("c".repeat(64), "r1")).rejects.toThrow(/request_id_key/);
  });
});
