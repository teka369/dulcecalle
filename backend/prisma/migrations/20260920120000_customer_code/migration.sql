-- AlterTable
ALTER TABLE "customers" ADD COLUMN "code" TEXT;

-- Backfill existing rows per business, oldest first. Archived keep their code (never reuse).
DO $$
DECLARE
  biz uuid;
  rec RECORD;
  n integer;
BEGIN
  FOR biz IN SELECT DISTINCT "business_id" FROM "customers" LOOP
    n := 0;
    FOR rec IN
      SELECT "id" FROM "customers"
      WHERE "business_id" = biz
      ORDER BY "created_at" ASC, "id" ASC
    LOOP
      n := n + 1;
      UPDATE "customers"
      SET "code" = 'DC-' || LPAD(n::text, 4, '0')
      WHERE "id" = rec.id;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE "customers" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "customers_business_id_code_key" ON "customers"("business_id", "code");
