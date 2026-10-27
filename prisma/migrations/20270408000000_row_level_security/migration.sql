-- Row-level security, a second safety net under scopedFor (docs/security/rls.md).
--
-- jane_rls is a role nobody logs in as. Each query through the user-scoped client
-- (src/lib/db-scoped.ts) switches to it for the length of one transaction, with the person's id
-- in app.user_id, and then the database itself returns and changes only that person's rows,
-- whatever the query says. Every other role (the app's own, which cron jobs, admin pages,
-- retention, trial cleanup and sign-in use) keeps the access it has today.
--
-- Nothing here can fail the migration: a database that can't make the role (missing CREATEROLE)
-- gets a warning, the app runs scoped queries as before (src/lib/rls.ts) and reports it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jane_rls') THEN
    -- Postgres 16+: let the role that makes jane_rls switch to it (SET ROLE). Older versions
    -- don't have the setting and don't need it.
    BEGIN
      PERFORM set_config('createrole_self_grant', 'set', true);
    EXCEPTION WHEN undefined_object OR invalid_parameter_value THEN
      NULL;
    END;
    CREATE ROLE jane_rls NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Row-level security is off: could not create the jane_rls role (%)', SQLERRM;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jane_rls') THEN
    -- The app's role must be able to switch to jane_rls.
    BEGIN
      EXECUTE format('GRANT jane_rls TO %I', current_user);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Could not grant jane_rls to %: %', current_user, SQLERRM;
    END;
    -- Tables made later can be read through the scoped client straight away; the next
    -- jane_rls_protect_all() (each deploy, scripts/rls-protect.mjs) narrows them to the rule.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jane_rls;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO jane_rls;
  END IF;
END
$$;

-- What jane_rls may see of each table, worked out from the catalog so new tables follow the
-- same rule without a list to keep up:
--   owner      a table with user_id: the person's own rows, read and write
--   child      no user_id, but points at a person's row: rows whose parents they can see
--   self       users: their own row, read only
--   household  households: the one they belong to, read only
--   reference  shared reference data a person's rows point at: read only, every row
--   none       everything else (audit_log, analytics_events, jobs, sign-in tokens...): nothing
CREATE OR REPLACE FUNCTION jane_rls_plan()
RETURNS TABLE (table_name text, kind text, visible text, privileges text[])
LANGUAGE sql STABLE AS $fn$
  WITH tables AS (
    SELECT c.oid, c.relname::text AS relname,
      (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped) AS user_id_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ),
  -- The system's own records of what happened: written and read only by the app's role.
  records AS (SELECT unnest(ARRAY['audit_log', 'analytics_events']) AS relname),
  owned AS (
    SELECT * FROM tables
    WHERE (user_id_type IS NOT NULL OR relname = 'users')
      AND relname NOT IN (SELECT relname FROM records)
  ),
  children AS (
    SELECT ch.relname,
      string_agg(format('EXISTS (SELECT 1 FROM %I p WHERE p.%I = %I.%I)',
        pa.relname, pk.attname, ch.relname, fk.attname), ' AND ' ORDER BY pa.relname, fk.attname) AS visible
    FROM pg_constraint con
    JOIN tables ch ON ch.oid = con.conrelid AND ch.user_id_type IS NULL
    JOIN owned pa ON pa.oid = con.confrelid
    JOIN pg_attribute fk ON fk.attrelid = con.conrelid AND fk.attnum = con.conkey[1]
    JOIN pg_attribute pk ON pk.attrelid = con.confrelid AND pk.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
      AND ch.relname NOT IN ('users', 'households')
      AND ch.relname NOT IN (SELECT relname FROM records)
    GROUP BY ch.relname
  )
  SELECT t.relname,
    CASE
      WHEN t.relname = 'users' THEN 'self'
      WHEN t.relname = 'households' THEN 'household'
      WHEN t.relname IN (SELECT relname FROM records) THEN 'none'
      WHEN t.user_id_type IS NOT NULL THEN 'owner'
      WHEN ch.visible IS NOT NULL THEN 'child'
      WHEN t.relname = 'referral_partners' THEN 'reference'
      ELSE 'none'
    END,
    CASE
      WHEN t.relname = 'users' THEN 'id = current_setting(''app.user_id'', true)'
      WHEN t.relname = 'households' THEN
        'EXISTS (SELECT 1 FROM household_members m WHERE m.household_id = households.id)'
      WHEN t.relname IN (SELECT relname FROM records) THEN NULL
      WHEN t.user_id_type IS NOT NULL THEN
        format('user_id = current_setting(''app.user_id'', true)::%s', t.user_id_type)
      ELSE ch.visible
    END,
    CASE
      WHEN t.relname IN (SELECT relname FROM records) THEN ARRAY[]::text[]
      WHEN t.relname IN ('users', 'households', 'referral_partners') THEN ARRAY['SELECT']
      WHEN t.user_id_type IS NOT NULL OR ch.visible IS NOT NULL THEN
        ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
      ELSE ARRAY[]::text[]
    END
  FROM tables t LEFT JOIN children ch ON ch.relname = t.relname
  ORDER BY t.relname
$fn$;

-- Brings every table in line with jane_rls_plan(). Idempotent and cheap when nothing changed.
-- Each table is its own step that gives up after 3s waiting on a lock (a busy table at deploy
-- time) instead of stalling traffic; skipped tables are returned and the next run finishes them
-- (each deploy fails until it has: scripts/rls-protect.mjs).
CREATE OR REPLACE FUNCTION jane_rls_protect_all()
RETURNS TABLE (protected integer, skipped text[])
LANGUAGE plpgsql AS $fn$
DECLARE
  t record;
  priv text;
  done integer := 0;
  missed text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jane_rls') THEN
    RAISE WARNING 'Row-level security is off: there is no jane_rls role';
    RETURN QUERY SELECT 0, ARRAY['(no jane_rls role)'];
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  GRANT USAGE ON SCHEMA public TO jane_rls;
  FOR t IN SELECT p.*, to_regclass(format('public.%I', p.table_name)) AS oid FROM jane_rls_plan() p LOOP
    BEGIN
      IF t.visible IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t.oid AND polname = 'jane_system') THEN
          -- Every role but jane_rls: the same access as before row-level security.
          EXECUTE format('CREATE POLICY jane_system ON %I USING (current_user <> ''jane_rls'') '
            'WITH CHECK (current_user <> ''jane_rls'')', t.table_name);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t.oid AND polname = 'jane_rls_owner') THEN
          EXECUTE format('CREATE POLICY jane_rls_owner ON %I TO jane_rls USING (%s) WITH CHECK (%s)',
            t.table_name, t.visible, t.visible);
        END IF;
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t.oid) THEN
          EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
        END IF;
      END IF;
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF priv = ANY (t.privileges) AND NOT has_table_privilege('jane_rls', t.oid, priv) THEN
          EXECUTE format('GRANT %s ON %I TO jane_rls', priv, t.table_name);
        ELSIF NOT priv = ANY (t.privileges) AND has_table_privilege('jane_rls', t.oid, priv) THEN
          EXECUTE format('REVOKE %s ON %I FROM jane_rls', priv, t.table_name);
        END IF;
      END LOOP;
      done := done + 1;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      missed := missed || t.table_name;
    END;
  END LOOP;
  RETURN QUERY SELECT done, missed;
END
$fn$;

REVOKE ALL ON FUNCTION jane_rls_protect_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION jane_rls_plan() FROM PUBLIC;

SELECT * FROM jane_rls_protect_all();
