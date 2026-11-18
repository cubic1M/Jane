-- Merchant names and keys drop Wells Fargo's words around a transfer to a company or person,
-- "ONLINE TRANSFER TO OAKWOOD RESIDENTIAL REF #IB0X4K2P9" (debugger 11-17: rent in a student's bills
-- read "Online Transfer To Oakwood Residential Ref"): key "oakwood residential". Only with the bank's
-- reference after it, as withoutOnlineTransfer in src/data-sources/merchant.ts: keep them in step.
-- Saved rows keyed or named the old way move, so a category, tax tag, answer or decision still applies.
CREATE OR REPLACE FUNCTION jane_merchant_key_without_online_transfer(k text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN k IS NULL THEN NULL
    ELSE regexp_replace(k, '^online transfer to (.+?) ref( on)?$', '\1', 'i')
  END
$$;

-- A finding's key names its merchant ("merchant:online transfer to oakwood residential ref",
-- "…@yearly", "card:<id>:merchant:…"): the merchant part moves, so a decision on the finding stays
-- with it.
CREATE OR REPLACE FUNCTION jane_finding_key_without_online_transfer(k text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  m text[];
BEGIN
  m := regexp_match(k, '^(.*?merchant:)(.+?)(@yearly)?$');
  IF m IS NULL THEN
    RETURN k;
  END IF;
  RETURN m[1] || jane_merchant_key_without_online_transfer(m[2]) || coalesce(m[3], '');
END
$$;

-- Stored names ("Online Transfer To Oakwood Residential Ref").
UPDATE transactions SET merchant_name = jane_merchant_key_without_online_transfer(merchant_name)
WHERE (merchant_name ILIKE 'online transfer to % ref' OR merchant_name ILIKE 'online transfer to % ref on')
  AND jane_merchant_key_without_online_transfer(merchant_name) <> merchant_name;

UPDATE recurring_streams SET merchant_name = jane_merchant_key_without_online_transfer(merchant_name)
WHERE (merchant_name ILIKE 'online transfer to % ref' OR merchant_name ILIKE 'online transfer to % ref on')
  AND jane_merchant_key_without_online_transfer(merchant_name) <> merchant_name;
-- One key per person: where the new key is already there, the newest row moves (the person's
-- own category first) and the rest stay unused.
UPDATE merchant_categories t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_online_transfer(merchant_key))
    id, jane_merchant_key_without_online_transfer(merchant_key) AS key
  FROM merchant_categories
  WHERE jane_merchant_key_without_online_transfer(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_online_transfer(merchant_key), (source = 'user') DESC, updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM merchant_categories o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

UPDATE subscription_checks t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_online_transfer(merchant_key))
    id, jane_merchant_key_without_online_transfer(merchant_key) AS key
  FROM subscription_checks
  WHERE jane_merchant_key_without_online_transfer(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_online_transfer(merchant_key), created_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM subscription_checks o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

UPDATE tax_tags t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_online_transfer(merchant_key))
    id, jane_merchant_key_without_online_transfer(merchant_key) AS key
  FROM tax_tags
  WHERE merchant_key IS NOT NULL AND jane_merchant_key_without_online_transfer(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_online_transfer(merchant_key), updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM tax_tags o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

-- No one-key rule on these.
UPDATE unusual_answers SET merchant_key = jane_merchant_key_without_online_transfer(merchant_key)
WHERE jane_merchant_key_without_online_transfer(merchant_key) <> merchant_key;

UPDATE insurance_policies SET merchant_key = jane_merchant_key_without_online_transfer(merchant_key)
WHERE merchant_key IS NOT NULL AND jane_merchant_key_without_online_transfer(merchant_key) <> merchant_key;

UPDATE findings t SET key = n.key
FROM (
  SELECT DISTINCT ON (user_id, type, jane_finding_key_without_online_transfer(key))
    id, jane_finding_key_without_online_transfer(key) AS key
  FROM findings
  WHERE jane_finding_key_without_online_transfer(key) <> key
  ORDER BY user_id, type, jane_finding_key_without_online_transfer(key), updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM findings o WHERE o.user_id = t.user_id AND o.type = t.type AND o.key = n.key);
