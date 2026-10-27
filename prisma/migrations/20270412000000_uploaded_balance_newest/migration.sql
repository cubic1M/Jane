-- Uploaded accounts holding an older statement's balance as today's: the newest statement's
-- instead (founder: Home's net worth was months stale after an account's months were uploaded
-- oldest first, src/lib/import/balances.ts keepFileBalances). Only where today's balance is one an
-- older statement gave, so a balance the person typed is left alone.
WITH newest AS (
  SELECT DISTINCT ON (account_id) account_id, balance_cents, date
  FROM balance_snapshots
  WHERE source = 'file'
  ORDER BY account_id, date DESC
)
UPDATE accounts a
SET current_balance_cents = n.balance_cents
FROM newest n
WHERE a.id = n.account_id
  AND a.source = 'csv'
  AND a.current_balance_cents IS DISTINCT FROM n.balance_cents
  AND EXISTS (
    SELECT 1 FROM balance_snapshots s
    WHERE s.account_id = a.id
      AND s.source = 'file'
      AND s.date < n.date
      AND s.balance_cents = a.current_balance_cents
  );

-- An uploaded account's daily copies of its balance (no source) say nothing its statements and
-- worked-back days don't, and held the stale balance on the days since the newest statement:
-- gone, as the import's rebuild now removes them too.
DELETE FROM balance_snapshots s
USING accounts a
WHERE s.account_id = a.id
  AND a.source = 'csv'
  AND s.source IS NULL
  AND s.date < CURRENT_DATE;
