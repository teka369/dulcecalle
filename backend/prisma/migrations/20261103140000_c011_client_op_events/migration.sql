-- C01.1 / C01-INV-04 (ADDITIVE ONLY): server-side trace of client rejections
-- and discards of money operations. New table; nothing existing is altered.
CREATE TABLE "client_op_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "request_id" UUID,
    "entity" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" BIGINT,
    "customer_id" UUID,
    "rejection_code" TEXT,
    "last_error" TEXT,
    "replaced_by" UUID,
    "device_created_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_op_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_op_events_business_id_operation_id_kind_key" ON "client_op_events"("business_id", "operation_id", "kind");
CREATE INDEX "client_op_events_business_id_created_at_idx" ON "client_op_events"("business_id", "created_at");
