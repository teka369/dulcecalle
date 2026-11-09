-- C01 (DC-01 / DC-16): late abonos are accepted instead of rejected.
-- ADDITIVE ONLY: new nullable / defaulted columns. No drops, no renames,
-- no backfill. Never applied to production without explicit approval.

ALTER TABLE "customer_payments"
  ADD COLUMN "occurred_at" TIMESTAMPTZ(3),
  ADD COLUMN "needs_review" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "cash_moves"
  ADD COLUMN "needs_review" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "cash_sessions"
  ADD COLUMN "unresolved_count" INTEGER,
  ADD COLUMN "unresolved_amount" BIGINT;
