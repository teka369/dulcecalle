ALTER TABLE "cash_sessions" ADD COLUMN "request_id" UUID;
CREATE UNIQUE INDEX "cash_sessions_business_id_request_id_key" ON "cash_sessions"("business_id", "request_id");
