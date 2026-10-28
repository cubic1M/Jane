-- Merchant names drop the payment app (overnight beta list): "ZELLE TO OAK RIDGE APTS RENT" is
-- Oak Ridge Apts, key "oak ridge apts", and "ZELLE FROM MOM" is "from mom". Saved rows keyed
-- the old way move to the new key, so a category, tax tag or answer the person gave still
-- applies. The patterns are withoutPaymentApp's in src/data-sources/merchant.ts, on the key
-- (its cleaned words, lower case); keep them in step.
CREATE OR REPLACE FUNCTION jane_merchant_key_without_app(k text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  m text[];
  payee text;
BEGIN
  IF k IS NULL THEN
    RETURN NULL;
  END IF;
  m := regexp_match(upper(k), '^(?:ZELLE|VENMO|CASH ?APP|APPLE CASH)(?: (?:PAYMENT|MONEY|TRANSFER))?(?: (?:SENT|RECEIVED))? (TO|FROM) (.+)$');
  IF m IS NULL THEN
    RETURN k;
  END IF;
  payee := regexp_replace(m[2], ' (?:FOR|ON|REF|CONF|MEMO)(?: .*)?$', '');
  payee := regexp_replace(payee, ' (?:RENT|PAYMENT|PMT)$', '');
  IF payee = '' THEN
    RETURN k;
  END IF;
  RETURN lower(CASE WHEN m[1] = 'FROM' THEN 'FROM ' || payee ELSE payee END);
END
$$;

-- One key per person: where two old keys meet in one new key, or the new key is already
-- there, the newest row moves (the person's own category first) and the rest stay unused.
UPDATE merchant_categories t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_app(merchant_key))
    id, jane_merchant_key_without_app(merchant_key) AS key
  FROM merchant_categories
  WHERE jane_merchant_key_without_app(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_app(merchant_key), (source = 'user') DESC, updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM merchant_categories o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

UPDATE subscription_checks t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_app(merchant_key))
    id, jane_merchant_key_without_app(merchant_key) AS key
  FROM subscription_checks
  WHERE jane_merchant_key_without_app(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_app(merchant_key), created_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM subscription_checks o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

UPDATE tax_tags t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_app(merchant_key))
    id, jane_merchant_key_without_app(merchant_key) AS key
  FROM tax_tags
  WHERE merchant_key IS NOT NULL AND jane_merchant_key_without_app(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_app(merchant_key), updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM tax_tags o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

-- No one-key rule on these.
UPDATE unusual_answers SET merchant_key = jane_merchant_key_without_app(merchant_key)
WHERE jane_merchant_key_without_app(merchant_key) <> merchant_key;

UPDATE insurance_policies SET merchant_key = jane_merchant_key_without_app(merchant_key)
WHERE merchant_key IS NOT NULL AND jane_merchant_key_without_app(merchant_key) <> merchant_key;
