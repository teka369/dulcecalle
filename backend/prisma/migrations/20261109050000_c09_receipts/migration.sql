-- C09-PR2 (ADDITIVE ONLY): verifiable receipts (SPEC-C09 §2, §3.2, §8).
-- New enum, new table, new trigger. No existing table or row is changed and
-- nothing is backfilled: receipts are emitted from now on, in the same
-- transaction as their source (I-C1).

CREATE TYPE "ReceiptKind" AS ENUM ('sale', 'payment', 'allocation', 'reversal', 'adjustment', 'return');

CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID,
    "kind" "ReceiptKind" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "verify_code" VARCHAR(10) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "prev_receipt_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id"),
    -- §3.2: base32 without ambiguous characters, 10 chars.
    CONSTRAINT "receipts_verify_code_format" CHECK ("verify_code" ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$'),
    CONSTRAINT "receipts_content_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$')
);

-- I-C1: exactly one receipt per (kind, source).
CREATE UNIQUE INDEX "receipts_business_id_kind_source_id_key" ON "receipts"("business_id", "kind", "source_id");
CREATE UNIQUE INDEX "receipts_business_id_number_key" ON "receipts"("business_id", "number");
CREATE UNIQUE INDEX "receipts_verify_code_key" ON "receipts"("verify_code");
CREATE INDEX "receipts_business_id_customer_id_created_at_idx" ON "receipts"("business_id", "customer_id", "created_at");
CREATE INDEX "receipts_business_id_created_at_idx" ON "receipts"("business_id", "created_at");

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_prev_receipt_id_fkey" FOREIGN KEY ("prev_receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- §3.2 / I-C2: immutable — no UPDATE, no DELETE (the business wipe included).
CREATE FUNCTION "receipts_insert_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RECEIPTS_IMMUTABLE: receipts are insert-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "receipts_insert_only"
  BEFORE UPDATE OR DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION "receipts_insert_only"();
