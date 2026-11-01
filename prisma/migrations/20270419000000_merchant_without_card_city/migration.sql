-- Merchant names and keys drop the city a card writes after the company (debugger 11-01): "DOORDASH
-- DASHPASS SAN FRANCISCO CA" is Doordash Dashpass, key "doordash dashpass". Saved rows keyed the
-- old way move to the new key, so a category, tax tag, answer or decision still applies. The
-- cities and the words that keep one are withoutCardCity's in src/data-sources/merchant.ts
-- (CARD_CITIES), on the key (its cleaned words, lower case); keep them in step.
CREATE OR REPLACE FUNCTION jane_merchant_key_without_city(k text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  city text;
  rest text;
BEGIN
  IF k IS NULL THEN
    RETURN NULL;
  END IF;
  FOREACH city IN ARRAY ARRAY[
    'new york', 'brooklyn', 'san francisco', 'los angeles', 'los gatos', 'san jose', 'oakland',
    'santa monica', 'palo alto', 'mountain view', 'menlo park', 'cupertino', 'sunnyvale',
    'san diego', 'seattle', 'redmond', 'portland', 'chicago', 'boston', 'austin', 'dallas',
    'houston', 'denver', 'phoenix', 'atlanta', 'miami', 'philadelphia'
  ] LOOP
    IF right(k, length(city) + 1) = ' ' || city THEN
      rest := left(k, length(k) - length(city) - 1);
      IF rest <> '' AND regexp_replace(rest, '^.* ', '') NOT IN ('of', 'in', 'at', 'the', '&', 'from', 'to') THEN
        RETURN rest;
      END IF;
      RETURN k;
    END IF;
  END LOOP;
  RETURN k;
END
$$;

-- A finding's key names its merchant ("merchant:doordash dashpass san francisco", "…@yearly",
-- "card:<id>:merchant:…"): the merchant part moves, so a decision on the finding stays with it.
CREATE OR REPLACE FUNCTION jane_finding_key_without_city(k text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  m text[];
BEGIN
  m := regexp_match(k, '^(.*?merchant:)(.+?)(@yearly)?$');
  IF m IS NULL THEN
    RETURN k;
  END IF;
  RETURN m[1] || jane_merchant_key_without_city(m[2]) || coalesce(m[3], '');
END
$$;

-- One key per person: where two old keys meet in one new key, or the new key is already
-- there, the newest row moves (the person's own category first) and the rest stay unused.
UPDATE merchant_categories t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_city(merchant_key))
    id, jane_merchant_key_without_city(merchant_key) AS key
  FROM merchant_categories
  WHERE jane_merchant_key_without_city(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_city(merchant_key), (source = 'user') DESC, updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM merchant_categories o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

UPDATE subscription_checks t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_city(merchant_key))
    id, jane_merchant_key_without_city(merchant_key) AS key
  FROM subscription_checks
  WHERE jane_merchant_key_without_city(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_city(merchant_key), created_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM subscription_checks o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

UPDATE tax_tags t SET merchant_key = n.key
FROM (
  SELECT DISTINCT ON (user_id, jane_merchant_key_without_city(merchant_key))
    id, jane_merchant_key_without_city(merchant_key) AS key
  FROM tax_tags
  WHERE merchant_key IS NOT NULL AND jane_merchant_key_without_city(merchant_key) <> merchant_key
  ORDER BY user_id, jane_merchant_key_without_city(merchant_key), updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM tax_tags o WHERE o.user_id = t.user_id AND o.merchant_key = n.key);

-- No one-key rule on these.
UPDATE unusual_answers SET merchant_key = jane_merchant_key_without_city(merchant_key)
WHERE jane_merchant_key_without_city(merchant_key) <> merchant_key;

UPDATE insurance_policies SET merchant_key = jane_merchant_key_without_city(merchant_key)
WHERE merchant_key IS NOT NULL AND jane_merchant_key_without_city(merchant_key) <> merchant_key;

UPDATE findings t SET key = n.key
FROM (
  SELECT DISTINCT ON (user_id, type, jane_finding_key_without_city(key))
    id, jane_finding_key_without_city(key) AS key
  FROM findings
  WHERE jane_finding_key_without_city(key) <> key
  ORDER BY user_id, type, jane_finding_key_without_city(key), updated_at DESC
) n
WHERE t.id = n.id
  AND NOT EXISTS (SELECT 1 FROM findings o WHERE o.user_id = t.user_id AND o.type = t.type AND o.key = n.key);
