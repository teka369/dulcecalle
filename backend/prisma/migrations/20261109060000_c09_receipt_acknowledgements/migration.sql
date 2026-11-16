-- C09-PR4 (ADDITIVE ONLY): customer confirmations of receipts (SPEC-C09 §3.3).
-- New enums, new table, new trigger. No existing table or row is changed.
-- An acknowledgement is extra evidence only: it never changes balances (I-C5).

CREATE TYPE "ReceiptAckKind" AS ENUM ('acknowledged', 'reported_issue');
CREATE TYPE "ReceiptAckChannel" AS ENUM ('portal', 'link');

CREATE TABLE "receipt_acknowledgements" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "receipt_hash" TEXT NOT NULL,
    "kind" "ReceiptAckKind" NOT NULL,
    "claim_id" UUID,
    "channel" "ReceiptAckChannel" NOT NULL,
    "note" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    CONSTRAINT "receipt_acknowledgements_pkey" PRIMARY KEY ("id"),
    -- The hash the customer saw (T15 compares it with the receipt's).
    CONSTRAINT "receipt_acknowledgements_hash_format" CHECK ("receipt_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "receipt_acknowledgements_note_len" CHECK ("note" IS NULL OR char_length("note") <= 280)
);

CREATE INDEX "receipt_acknowledgements_business_id_receipt_id_at_idx" ON "receipt_acknowledgements"("business_id", "receipt_id", "at");
CREATE INDEX "receipt_acknowledgements_business_id_customer_id_at_idx" ON "receipt_acknowledgements"("business_id", "customer_id", "at");

ALTER TABLE "receipt_acknowledgements" ADD CONSTRAINT "receipt_acknowledgements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_acknowledgements" ADD CONSTRAINT "receipt_acknowledgements_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- §3.3: insert-only (like receipts; the business wipe does not touch them).
CREATE FUNCTION "receipt_acknowledgements_insert_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RECEIPT_ACKS_IMMUTABLE: receipt acknowledgements are insert-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "receipt_acknowledgements_insert_only"
  BEFORE UPDATE OR DELETE ON "receipt_acknowledgements"
  FOR EACH ROW EXECUTE FUNCTION "receipt_acknowledgements_insert_only"();
