-- TICKET-A (O2): explicit product kind.
-- Every existing row becomes `standard`: NO automatic backfill (J-A2).
-- Combos are reclassified only after manual review via
-- backend/scripts/combo-kind-backfill.ts (never run automatically).
CREATE TYPE "ProductKind" AS ENUM ('standard', 'combo');

ALTER TABLE "products"
  ADD COLUMN "kind" "ProductKind" NOT NULL DEFAULT 'standard';

-- A combo can never be sellable.
ALTER TABLE "products"
  ADD CONSTRAINT "products_combo_not_sellable"
  CHECK ("kind" <> 'combo' OR "sellable" = false);
