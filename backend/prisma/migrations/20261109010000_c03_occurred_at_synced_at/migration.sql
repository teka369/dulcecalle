-- C03 / DC-06 (ADDITIVE ONLY): distinguish when an op happened vs when
-- the server received it. Nullable columns; legacy rows keep NULL.
-- API falls back to created_at. No backfill, no rewrite, no drop.
ALTER TABLE "sales" ADD COLUMN "occurred_at" TIMESTAMPTZ(3);
ALTER TABLE "sales" ADD COLUMN "synced_at" TIMESTAMPTZ(3);
ALTER TABLE "customer_payments" ADD COLUMN "synced_at" TIMESTAMPTZ(3);
