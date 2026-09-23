-- Preparation (Producción): combo → finished units. Source lots are not
-- decremented (total yield unknown at purchase); the record is the trace.
-- Safe on PG12+: ADD VALUE inside a transaction block is allowed as long as
-- the new value is not used until commit (it isn't: rows come later).
ALTER TYPE "StockMoveReason" ADD VALUE 'preparacion';

-- Supply/combo flag. Existing rows default to sellable: current catalog
-- behavior is unchanged until the user marks a product as insumo.
ALTER TABLE "products" ADD COLUMN "sellable" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "preparations" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "target_id" UUID NOT NULL,
  "qty" INTEGER NOT NULL,
  "unit_cost" BIGINT NOT NULL,
  "note" TEXT,
  "request_id" UUID,
  "occurred_on" DATE NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preparations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "preparations_business_id_request_id_key" ON "preparations"("business_id", "request_id");
CREATE INDEX "preparations_business_id_source_id_created_at_idx" ON "preparations"("business_id", "source_id", "created_at");
CREATE INDEX "preparations_business_id_target_id_created_at_idx" ON "preparations"("business_id", "target_id", "created_at");

ALTER TABLE "preparations" ADD CONSTRAINT "preparations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "preparations" ADD CONSTRAINT "preparations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "preparations" ADD CONSTRAINT "preparations_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
