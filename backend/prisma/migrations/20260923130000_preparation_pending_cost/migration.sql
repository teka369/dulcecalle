-- Pending cost is distinct from real zero: null leaves the finished average
-- untouched, 0 dilutes it (gifted batch). Existing rows (if any) predate
-- real usage and carry explicit assigned values, so no backfill is needed.
ALTER TABLE "preparations" ALTER COLUMN "unit_cost" DROP NOT NULL;
