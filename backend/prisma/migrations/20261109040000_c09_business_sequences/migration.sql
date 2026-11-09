-- C09-PR1 (ADDITIVE ONLY): per-business sequences and human numbers
-- (SPEC-C09 §3.1, decisions 5, 13, 26).
--   sales.number             → DC-000001   (kind sale)
--   customer_payments.number → DC-P-000001 (kind payment)
--   reversals.number (C07, text, unchanged) → DC-R-000001 (kind reversal)
--   adjustment (DC-A-) and return (DC-D-) are reserved kinds (no rows yet).
-- No drop, no rename, no type change. The only UPDATE fills the NEW number
-- columns of historic rows, deterministically by (created_at, id) per business.

CREATE TYPE "SequenceKind" AS ENUM ('sale', 'payment', 'reversal', 'adjustment', 'return');

CREATE TABLE "business_sequences" (
    "business_id" UUID NOT NULL,
    "kind" "SequenceKind" NOT NULL,
    "next" BIGINT NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_sequences_pkey" PRIMARY KEY ("business_id", "kind"),
    CONSTRAINT "business_sequences_next_positive" CHECK ("next" >= 1)
);
ALTER TABLE "business_sequences" ADD CONSTRAINT "business_sequences_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales" ADD COLUMN "number" INTEGER;
ALTER TABLE "customer_payments" ADD COLUMN "number" INTEGER;

-- Historic numbering (deterministic: created_at, then id).
UPDATE "sales" s SET "number" = n.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "business_id" ORDER BY "created_at", "id") AS rn FROM "sales"
) n
WHERE s."id" = n."id";

UPDATE "customer_payments" p SET "number" = n.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "business_id" ORDER BY "created_at", "id") AS rn FROM "customer_payments"
) n
WHERE p."id" = n."id";

-- I-C6: unique per business (NULLs allowed only for rows written by older code).
CREATE UNIQUE INDEX "sales_business_id_number_key" ON "sales"("business_id", "number");
CREATE UNIQUE INDEX "customer_payments_business_id_number_key" ON "customer_payments"("business_id", "number");

-- Seed every business: next = historic maximum + 1. Reversals keep their
-- DC-R-NNNNNN text; the counter continues after the highest one.
INSERT INTO "business_sequences" ("business_id", "kind", "next")
SELECT b."id", 'sale'::"SequenceKind", COALESCE((SELECT MAX(s."number") FROM "sales" s WHERE s."business_id" = b."id"), 0) + 1
FROM "businesses" b;

INSERT INTO "business_sequences" ("business_id", "kind", "next")
SELECT b."id", 'payment'::"SequenceKind", COALESCE((SELECT MAX(p."number") FROM "customer_payments" p WHERE p."business_id" = b."id"), 0) + 1
FROM "businesses" b;

INSERT INTO "business_sequences" ("business_id", "kind", "next")
SELECT b."id", 'reversal'::"SequenceKind", COALESCE((
  SELECT MAX(substring(r."number" FROM '^DC-R-([0-9]+)$')::bigint) FROM "reversals" r WHERE r."business_id" = b."id"
), 0) + 1
FROM "businesses" b;
