-- C07 / DC-05 (ADDITIVE ONLY): anulaciones y reversos compensatorios.
-- A reversal never updates or deletes the original rows: it adds
-- compensating cash moves, stock moves and debt_allocations rows.
-- No drop, no rename, no rewrite, no backfill.

CREATE TYPE "ReversalTarget" AS ENUM ('sale', 'customer_payment', 'expense', 'initial_debt', 'cash_move');
CREATE TYPE "ReversalReason" AS ENUM ('error_digitacion', 'cliente_equivocado', 'monto_equivocado', 'duplicado', 'devolucion', 'otro');

ALTER TYPE "CashMoveKind" ADD VALUE IF NOT EXISTS 'reverso';
ALTER TYPE "StockMoveReason" ADD VALUE IF NOT EXISTS 'anulacion';

CREATE TABLE "reversals" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "target_type" "ReversalTarget" NOT NULL,
    "target_id" UUID NOT NULL,
    "reason_code" "ReversalReason" NOT NULL,
    "reason_text" TEXT,
    "old_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "requested_by" UUID NOT NULL,
    "occurred_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "replacement_id" UUID,
    CONSTRAINT "reversals_pkey" PRIMARY KEY ("id"),
    -- I-R7 / decision 14: free text is mandatory only for «otro».
    CONSTRAINT "reversals_reason_text_otro" CHECK (
      "reason_code" <> 'otro' OR ("reason_text" IS NOT NULL AND char_length(btrim("reason_text")) >= 5)
    ),
    CONSTRAINT "reversals_reason_text_len" CHECK ("reason_text" IS NULL OR char_length("reason_text") <= 280)
);

-- I-R2: one reversal per target. G7: idempotency key. Decision 13: DC-R- per business.
CREATE UNIQUE INDEX "reversals_business_id_target_type_target_id_key" ON "reversals"("business_id", "target_type", "target_id");
CREATE UNIQUE INDEX "reversals_business_id_request_id_key" ON "reversals"("business_id", "request_id");
CREATE UNIQUE INDEX "reversals_business_id_number_key" ON "reversals"("business_id", "number");
CREATE INDEX "reversals_business_id_occurred_on_idx" ON "reversals"("business_id", "occurred_on");

ALTER TABLE "reversals" ADD CONSTRAINT "reversals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- C07 — a reversal row moves money that originally came from another
-- source (a payment, a return, a credit refund). The origin keeps the
-- per-source trace (I-A1) without touching the original rows.
ALTER TABLE "debt_allocations" ADD COLUMN "origin_source_type" "AllocationSource";
ALTER TABLE "debt_allocations" ADD COLUMN "origin_source_id" UUID;
ALTER TABLE "debt_allocations" ADD CONSTRAINT "debt_allocations_origin_only_reversal" CHECK (
  ("origin_source_type" IS NULL AND "origin_source_id" IS NULL)
  OR ("source_type" = 'reversal' AND "origin_source_type" IS NOT NULL AND "origin_source_id" IS NOT NULL AND "origin_source_type" <> 'reversal')
);
