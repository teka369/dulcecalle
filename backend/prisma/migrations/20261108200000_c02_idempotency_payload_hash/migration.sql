-- C02 / DC-13 (ADDITIVE ONLY): bind an Idempotency-Key to its payload.
-- Nullable columns; legacy rows keep NULL. No backfill, no rewrite, no drop.
ALTER TABLE "sales" ADD COLUMN "payload_hash" TEXT;
ALTER TABLE "customer_payments" ADD COLUMN "payload_hash" TEXT;
