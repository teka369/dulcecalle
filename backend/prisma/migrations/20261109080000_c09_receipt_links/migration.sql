-- C09-PR5 (ADDITIVE ONLY): one-use receipt links (SPEC-C09 §3.4, §5).
-- New table only. Only the sha256 of the token is stored; the link expires
-- 48 h after it is created, is spent on the first successful link-login and
-- can be revoked by the owner. No existing table or row is changed.
-- The token is 32 random bytes; repeating the request mints a NEW link (the
-- old one stays valid until its 48 h), so request_id is kept for audit only.

CREATE TABLE "receipt_links" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "receipt_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "receipt_links_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "receipt_links_expiry_after_creation" CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "receipt_links_token_hash_key" ON "receipt_links"("token_hash");
CREATE INDEX "receipt_links_business_id_receipt_id_idx" ON "receipt_links"("business_id", "receipt_id");

ALTER TABLE "receipt_links" ADD CONSTRAINT "receipt_links_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_links" ADD CONSTRAINT "receipt_links_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
