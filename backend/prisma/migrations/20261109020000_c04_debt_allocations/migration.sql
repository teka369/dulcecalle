-- C04 / DC-04, DC-20, DC-54 (ADDITIVE ONLY): debt allocations (imputación
-- de abonos), saldo a favor and return remainder choice. No drop, no rename,
-- no backfill of historical financial rows (backend/ops/backfill-allocations.ts
-- is a separate, manual, dry-run-by-default script).

CREATE TYPE "AllocationSource" AS ENUM ('payment', 'sale_return', 'reversal', 'credit_refund');
CREATE TYPE "AllocationTarget" AS ENUM ('sale', 'initial_debt', 'credit');
CREATE TYPE "AllocationMode" AS ENUM ('fifo', 'explicit', 'backfill', 'credit_apply', 'reversal');
CREATE TYPE "ReturnRemainderMode" AS ENUM ('refund', 'credit');

ALTER TYPE "CashMoveKind" ADD VALUE IF NOT EXISTS 'reembolso_saldo';

CREATE TABLE "debt_allocations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "source_type" "AllocationSource" NOT NULL,
    "source_id" UUID NOT NULL,
    "target_type" "AllocationTarget" NOT NULL,
    "sale_id" UUID,
    "initial_debt_id" UUID,
    "amount" BIGINT NOT NULL,
    "mode" "AllocationMode" NOT NULL,
    "group_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "debt_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "debt_allocations_amount_nonzero" CHECK ("amount" <> 0),
    CONSTRAINT "debt_allocations_one_target" CHECK (
      ("target_type" = 'sale' AND "sale_id" IS NOT NULL AND "initial_debt_id" IS NULL)
      OR ("target_type" = 'initial_debt' AND "initial_debt_id" IS NOT NULL AND "sale_id" IS NULL)
      OR ("target_type" = 'credit' AND "sale_id" IS NULL AND "initial_debt_id" IS NULL)
    )
);

CREATE INDEX "debt_allocations_business_id_customer_id_idx" ON "debt_allocations"("business_id", "customer_id");
CREATE INDEX "debt_allocations_business_id_sale_id_idx" ON "debt_allocations"("business_id", "sale_id");
CREATE INDEX "debt_allocations_business_id_source_type_source_id_idx" ON "debt_allocations"("business_id", "source_type", "source_id");

ALTER TABLE "debt_allocations" ADD CONSTRAINT "debt_allocations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debt_allocations" ADD CONSTRAINT "debt_allocations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debt_allocations" ADD CONSTRAINT "debt_allocations_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debt_allocations" ADD CONSTRAINT "debt_allocations_initial_debt_id_fkey" FOREIGN KEY ("initial_debt_id") REFERENCES "initial_debts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Saldo a favor cache (same writers/pattern as debt).
ALTER TABLE "customers" ADD COLUMN "credit_balance" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD CONSTRAINT "customers_credit_balance_nonneg" CHECK ("credit_balance" >= 0);
-- DC-20: debt never below 0. NOT VALID = enforced for every new write without
-- scanning/rejecting legacy rows during deploy (validate later, after review).
ALTER TABLE "customers" ADD CONSTRAINT "customers_debt_nonneg" CHECK ("debt" >= 0) NOT VALID;

ALTER TABLE "customer_payments" ADD COLUMN "requested_target" JSONB;
ALTER TABLE "customer_payments" ADD COLUMN "allocation_result" JSONB;
ALTER TABLE "customer_payments" ADD COLUMN "allocation_adjusted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_payments" ADD COLUMN "adjusted_reviewed_at" TIMESTAMPTZ(3);
ALTER TABLE "customer_payments" ADD COLUMN "adjusted_reviewed_by" UUID;
ALTER TABLE "customer_payments" ADD COLUMN "replaces_payment_id" UUID;

ALTER TABLE "sale_returns" ADD COLUMN "needs_review" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sale_returns" ADD COLUMN "remainder_mode" "ReturnRemainderMode";
