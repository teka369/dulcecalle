-- READ-ONLY. Lists businesses with more than one open cash session
-- (closed_at IS NULL). Any row here makes migration
-- 20261007160000_cash_one_open_guard fail with MULTIPLE_OPEN_CASH_SESSIONS.
-- Regularize in "Gestionar cajas"; this query changes nothing.
SELECT business_id,
       count(*)                         AS open_sessions,
       array_agg(id ORDER BY local_date) AS session_ids,
       array_agg(local_date ORDER BY local_date) AS local_dates,
       min(opened_at)                   AS oldest_opened_at
FROM cash_sessions
WHERE closed_at IS NULL
GROUP BY business_id
HAVING count(*) > 1
ORDER BY open_sessions DESC, business_id;
