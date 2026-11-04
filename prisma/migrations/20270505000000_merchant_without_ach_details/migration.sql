-- Merchant names and keys stop at the company on an ACH line (the metamorphic suite, the same
-- statement through every bank's layout): Chase's "ORIG CO NAME:USAA P&C ORIG ID:… IND NAME:RAJ MEHTA"
-- put the account holder's name in the merchant's, and "STATE FARM INSURANCE BILL PAY" read as
-- another company from "STATE FARM INSURANCE". Saved rows keyed or named the old way move, so a
-- category, tax tag, answer or decision still applies. A Wells Fargo key with the holder's name on
-- the end can't be told from the key alone, and moves when the file is uploaded again. The words are
-- ACH_DETAILS and ACH_ENTRY in src/data-sources/merchant.ts; keep them in step.
CREATE OR REPLACE FUNCTION jane_merchant_key_without_ach_details(k text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN k IS NULL THEN NULL
    WHEN k ~* '^chase +(bill ?pay|auto ?pay|(web|online|mobile) pmt)$' THEN k
    ELSE regexp_replace(
      regexp_replace(k, ' +orig id( .*)?$', '', 'i'),
      ' +(bill ?pay|auto ?pay|(web|online|mobile) pmt)$', '', 'i'
    )
  END
$$;

-- A finding's key names its merchant ("merchant:state farm bill pay", "…@yearly",
-- "card:<id>:merchant:…"): the merchant part moves, so a decision on the finding stays with it.
CREATE OR REPLACE FUNCTION jane_finding_key_without_ach_details(k text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  m text[];
BEGIN
  m := regexp_match(k, '^(.*?merchant:)(.+?)(@yearly)?$');
  IF m IS NULL THEN
    RETURN k;
  END IF;
  RETURN m[1] || jane_merchant_key_without_ach_details(m[2]) || coalesce(m[3], '');
END
$$;

-- Stored names ("State Farm Insurance Bill Pay").
UPDATE transactions SET merchant_name = jane_merchant_key_without_ach_details(merchant_name)
WHERE merchant_name ~* ' (orig id|bill ?pay|auto ?pay|(web|online|mobile) pmt)'
  AND jane_merchant_key_without_ach_details(merchant_name) <> merchant_name;

UPDATE recurring_streams SET merchant_name = jane_merchant_key_without_ach_details(merchant_name)
WHERE merchant_name ~* ' (orig id|bill ?pay|auto ?pay|(web|online|mobile) pmt)'
  AND jane_merchant_key_without_ach_details(merchant_name) <> merchant_name;

-- One key per person: where the new key is already there, the newest row moves (the person's
-- own category first) and the rest stay unused.
UPDATE merchant_categories t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_ach_details(merchant_key))
    id, jane_merchant_key_without_ach_details(merchant_key) AS key
  FROM merchant_categories
  WHERE jane_merchant_key_without_ach_details(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_ach_details(merchant_key), (source = 'user') DESC, updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM merchant_categories o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

UPDATE subscription_checks t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_ach_details(merchant_key))
    id, jane_merchant_key_without_ach_details(merchant_key) AS key
  FROM subscription_checks
  WHERE jane_merchant_key_without_ach_details(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_ach_details(merchant_key), created_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM subscription_checks o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

UPDATE tax_tags t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_ach_details(merchant_key))
    id, jane_merchant_key_without_ach_details(merchant_key) AS key
  FROM tax_tags
  WHERE merchant_key IS NOT NULL AND jane_merchant_key_without_ach_details(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_ach_details(merchant_key), updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM tax_tags o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

-- No one-key rule on these.
UPDATE unusual_answers SET merchant_key = jane_merchant_key_without_ach_details(merchant_key)
WHERE jane_merchant_key_without_ach_details(merchant_key) <> merchant_key;

UPDATE insurance_policies SET merchant_key = jane_merchant_key_without_ach_details(merchant_key)
WHERE merchant_key IS NOT NULL AND jane_merchant_key_without_ach_details(merchant_key) <> merchant_key;

UPDATE findings t SET key = n.key
FROM (
  SELECT DISTINCT ON (user_id, type, jane_finding_key_without_ach_details(key))
    id, jane_finding_key_without_ach_details(key) AS key
  FROM findings
  WHERE jane_finding_key_without_ach_details(key) <> key
  ORDER BY user_id, type, jane_finding_key_without_ach_details(key), updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM findings o WHERE o.user_id = t.user_id AND o.type = t.type AND o.key = n.key);
