/**
 * C09-PR4 — migration 20261109060000_c09_receipt_acknowledgements (G-MIG): additive (new
 * enum, tables and trigger only); existing rows untouched; no backfill.
 * Embedded Postgres only, fictitious data.
 */
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations");
const PR4 = "20261109060000_c09_receipt_acknowledgements";
const sql = (name: string) => fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
const before = fs
  .readdirSync(MIGRATIONS)
  .filter((d) => /^\d{14}_/.test(d) && d < PR4)
  .sort();

describe("C09-PR4 receipt acknowledgements migration", () => {
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

  it("adds receipt_acknowledgements on a schema with data; receipts and other rows untouched; insert-only", async () => {
    await db.query(`DROP SCHEMA IF EXISTS c09a CASCADE; CREATE SCHEMA c09a; SET search_path TO c09a;`);
    for (const m of before) await db.query(sql(m));
    const biz = randomUUID();
    const rid = randomUUID();
    await db.query(`INSERT INTO businesses (id, name) VALUES ($1, 'B')`, [biz]);
    await db.query(
      `INSERT INTO receipts (id, business_id, customer_id, kind, source_type, source_id, number, verify_code, snapshot, content_hash)
       VALUES ($1, $2, $3, 'payment', 'customer_payment', $4, 'DC-P-000001', '23456789AB', '{}', $5)`,
      [rid, biz, randomUUID(), randomUUID(), "a".repeat(64)],
    );
    const pre = await db.query(`SELECT row_to_json(r)::text j FROM receipts r ORDER BY id`);
    await db.query(sql(PR4));
    expect((await db.query(`SELECT row_to_json(r)::text j FROM receipts r ORDER BY id`)).rows).toEqual(pre.rows);
    expect((await db.query(`SELECT count(*)::int n FROM receipt_acknowledgements`)).rows[0]!.n).toBe(0);
    const ack = randomUUID();
    await db.query(
      `INSERT INTO receipt_acknowledgements (id, business_id, customer_id, receipt_id, receipt_hash, kind, channel)
       VALUES ($1, $2, $3, $4, $5, 'acknowledged', 'portal')`,
      [ack, biz, randomUUID(), rid, "a".repeat(64)],
    );
    await expect(db.query(`UPDATE receipt_acknowledgements SET note = 'x' WHERE id = $1`, [ack])).rejects.toThrow(/RECEIPT_ACKS_IMMUTABLE/);
    await expect(db.query(`DELETE FROM receipt_acknowledgements WHERE id = $1`, [ack])).rejects.toThrow(/RECEIPT_ACKS_IMMUTABLE/);
    await expect(
      db.query(
        `INSERT INTO receipt_acknowledgements (id, business_id, customer_id, receipt_id, receipt_hash, kind, channel) VALUES ($1, $2, $3, $4, 'nothex', 'acknowledged', 'portal')`,
        [randomUUID(), biz, randomUUID(), rid],
      ),
    ).rejects.toThrow(/hash_format/);
  });
});
