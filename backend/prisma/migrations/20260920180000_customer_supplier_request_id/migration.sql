-- Idempotency keys for catalog creates (M6.0). NULL allowed for imported rows.
ALTER TABLE "customers" ADD COLUMN "request_id" UUID;
CREATE UNIQUE INDEX "customers_business_id_request_id_key" ON "customers"("business_id", "request_id");

ALTER TABLE "suppliers" ADD COLUMN "request_id" UUID;
CREATE UNIQUE INDEX "suppliers_business_id_request_id_key" ON "suppliers"("business_id", "request_id");
