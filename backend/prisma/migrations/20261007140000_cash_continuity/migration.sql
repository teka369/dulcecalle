-- Additive. Continuity is not openingFloat and close has its own request id.
ALTER TABLE "cash_sessions" ADD COLUMN "carried_efectivo" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "cash_sessions" ADD COLUMN "close_request_id" UUID;
CREATE UNIQUE INDEX "cash_sessions_business_id_close_request_id_key"
  ON "cash_sessions"("business_id", "close_request_id");
