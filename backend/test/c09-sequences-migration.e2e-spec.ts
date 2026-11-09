/**
 * C09-PR1 — migration 20261109040000_c09_business_sequences (G-MIG):
 * additive; historic sales / abonos are numbered deterministically by
 * (created_at, id) per business; reversals keep their DC-R- text; the
 * sequences start after the historic maximum. Embedded Postgres only,
 * fictitious data.
 */
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations");
const C09 = "20261109040000_c09_business_sequences";
const sql = (name: string) => fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
const before = fs
  .readdirSync(MIGRATIONS)
  .filter((d) => /^\d{14}_/.test(d) && d < C09)
  .sort();

describe("C09-PR1 sequences migration", () => {
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

  async function freshSchema(name: string) {
    await db.query(`DROP SCHEMA IF EXISTS ${name} CASCADE; CREATE SCHEMA ${name}; SET search_path TO ${name};`);
    for (const m of before) await db.query(sql(m));
  }
  async function business() {
    const id = randomUUID();
    await db.query(`INSERT INTO businesses (id, name) VALUES ($1, 'B')`, [id]);
    return id;
  }
  async function customer(biz: string, code: string) {
    const id = randomUUID();
    await db.query(`INSERT INTO customers (id, business_id, code, name, updated_at) VALUES ($1, $2, $3, 'Ana', now())`, [id, biz, code]);
    return id;
  }
  async function sale(biz: string, createdAt: string, id = randomUUID()) {
    await db.query(
      `INSERT INTO sales (id, business_id, payment_kind, method, sale_total, amount_received, credit, occurred_on, created_at)
       VALUES ($1, $2, 'paid', 'Efectivo', 1000, 1000, 0, '2026-10-01', $3)`,
      [id, biz, createdAt],
    );
    return id;
  }
  async function payment(biz: string, cust: string, createdAt: string) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO customer_payments (id, business_id, customer_id, amount, method, occurred_on, created_at)
       VALUES ($1, $2, $3, 500, 'Efectivo', '2026-10-01', $4)`,
      [id, biz, cust, createdAt],
    );
    return id;
  }
  async function reversal(biz: string, number: string) {
    await db.query(
      `INSERT INTO reversals (id, business_id, number, target_type, target_id, reason_code, requested_by, occurred_on, request_id, payload_hash, before, after)
       VALUES ($1, $2, $3, 'sale', $4, 'duplicado', $5, '2026-10-01', $6, 'h', '{}', '{}')`,
      [randomUUID(), biz, number, randomUUID(), randomUUID(), randomUUID()],
    );
  }

  it("on an empty schema it only adds objects", async () => {
    await freshSchema("c09_empty");
    await db.query(sql(C09));
    const t = await db.query(`SELECT count(*)::int n FROM business_sequences`);
    expect(t.rows[0]!.n).toBe(0);
    const cols = await db.query(
      `SELECT table_name, is_nullable FROM information_schema.columns
       WHERE table_schema = current_schema() AND column_name = 'number' AND table_name IN ('sales', 'customer_payments') ORDER BY table_name`,
    );
    expect(cols.rows).toEqual([
      { table_name: "customer_payments", is_nullable: "YES" },
      { table_name: "sales", is_nullable: "YES" },
    ]);
  });

  it("numbers historic rows by (created_at, id) per business and seeds the sequences after the maximum", async () => {
    await freshSchema("c09_data");
    const a = await business();
    const b = await business();
    const empty = await business();
    // Same created_at: the id breaks the tie (deterministic).
    const tieLow = "00000000-0000-4000-8000-000000000001";
    const tieHigh = "00000000-0000-4000-8000-000000000002";
    const s3 = await sale(a, "2026-10-03T10:00:00Z");
    const s1 = await sale(a, "2026-10-01T10:00:00Z", tieHigh);
    const s0 = await sale(a, "2026-10-01T10:00:00Z", tieLow);
    const sb = await sale(b, "2026-09-01T10:00:00Z");
    const ca = await customer(a, "DC-0001");
    const p2 = await payment(a, ca, "2026-10-05T10:00:00Z");
    const p1 = await payment(a, ca, "2026-10-04T10:00:00Z");
    await reversal(a, "DC-R-000001");
    await reversal(a, "DC-R-000002");
    const pre = await db.query(`SELECT id, sale_total, created_at FROM sales ORDER BY id`);

    await db.query(sql(C09));

    const nums = await db.query(`SELECT id, number FROM sales ORDER BY number, id`);
    const byId = new Map(nums.rows.map((r) => [r.id as string, r.number as number]));
    expect([byId.get(s0), byId.get(s1), byId.get(s3), byId.get(sb)]).toEqual([1, 2, 3, 1]);
    const pays = await db.query(`SELECT id, number FROM customer_payments`);
    const pById = new Map(pays.rows.map((r) => [r.id as string, r.number as number]));
    expect([pById.get(p1), pById.get(p2)]).toEqual([1, 2]);
    const seqs = await db.query(`SELECT business_id, kind::text kind, next::int next FROM business_sequences ORDER BY business_id, kind`);
    const of = (biz: string) => Object.fromEntries(seqs.rows.filter((r) => r.business_id === biz).map((r) => [r.kind, r.next]));
    expect(of(a)).toEqual({ sale: 4, payment: 3, reversal: 3 });
    expect(of(b)).toEqual({ sale: 2, payment: 1, reversal: 1 });
    expect(of(empty)).toEqual({ sale: 1, payment: 1, reversal: 1 });
    // Additive: the original columns are untouched.
    expect((await db.query(`SELECT id, sale_total, created_at FROM sales ORDER BY id`)).rows).toEqual(pre.rows);
    // I-C6: unique per business.
    await expect(db.query(`UPDATE sales SET number = 1 WHERE id = $1`, [s3])).rejects.toMatchObject({ code: "23505" });
    // Another business may reuse 1.
    expect(byId.get(sb)).toBe(1);
  });
});
