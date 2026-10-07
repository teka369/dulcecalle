-- Fails safely if any business still has more than one open session.
-- Does not close, delete, or reassign anything.
DO $$
DECLARE
  conflicts integer;
BEGIN
  SELECT count(*) INTO conflicts
  FROM (
    SELECT business_id
    FROM cash_sessions
    WHERE closed_at IS NULL
    GROUP BY business_id
    HAVING count(*) > 1
  ) open_conflicts;
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'MULTIPLE_OPEN_CASH_SESSIONS: % business(es) still have more than one open cash session. Regularize them in Gestionar cajas. This migration does not close any session.', conflicts;
  END IF;
END $$;

CREATE UNIQUE INDEX "cash_sessions_one_open_per_business"
  ON "cash_sessions"("business_id")
  WHERE "closed_at" IS NULL;
