-- Additive only. Does not close sessions, reassign moves, or add the one-open index.
ALTER TABLE "cash_sessions" ADD COLUMN "close_mode" TEXT;

ALTER TABLE "cash_moves" ADD COLUMN "pending_for_session_id" UUID;

ALTER TABLE "cash_moves"
  ADD CONSTRAINT "cash_moves_pending_for_session_id_fkey"
  FOREIGN KEY ("pending_for_session_id") REFERENCES "cash_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cash_moves_business_id_pending_for_session_id_idx"
  ON "cash_moves"("business_id", "pending_for_session_id");

CREATE TABLE "cash_carries" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "previous_session_id" UUID,
  "current_session_id" UUID NOT NULL,
  "mode" TEXT NOT NULL,
  "counted_efectivo" BIGINT,
  "opening_float" BIGINT NOT NULL,
  "reassigned_count" INTEGER NOT NULL,
  "reassigned_ids" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_carries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cash_carries_business_id_request_id_key"
  ON "cash_carries"("business_id", "request_id");

ALTER TABLE "cash_carries"
  ADD CONSTRAINT "cash_carries_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
