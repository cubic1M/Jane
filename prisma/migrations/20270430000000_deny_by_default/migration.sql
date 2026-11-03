-- Deny by default (docs/security/rls.md). jane_rls is the door to one person's rows; jane_system,
-- also a role nobody logs in as, is the door to the whole room, for the code that truly works
-- across people (src/lib/system-db.ts). A login role with no privileges of its own (jane_app, made
-- by hand in production, see the doc) can do nothing but go through one of the two doors, so a
-- query that forgot to choose fails instead of seeing everyone.
--
-- Nothing changes for a database still logging in as its owner: the owner can use the tables
-- whichever role it is, and the switch to jane_system only narrows what it may touch to the same
-- tables. As with jane_rls, nothing here can fail the migration: a database that can't make the
-- role gets a warning, and system queries run as the login role (src/lib/rls.ts) and it is reported.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jane_system') THEN
    BEGIN
      PERFORM set_config('createrole_self_grant', 'set', true);
    EXCEPTION WHEN undefined_object OR invalid_parameter_value THEN
      NULL;
    END;
    CREATE ROLE jane_system NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'System role is off: could not create the jane_system role (%)', SQLERRM;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jane_system') THEN
    BEGIN
      EXECUTE format('GRANT jane_system TO %I', current_user);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Could not grant jane_system to %: %', current_user, SQLERRM;
    END;
    -- Tables made later work through systemDb straight away.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO jane_system;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO jane_system;
  END IF;
END
$$;

-- As before, and also: jane_system may use every table, and a jane_app login, if the database has
-- one, may become either role and may use no table itself.
CREATE OR REPLACE FUNCTION jane_rls_protect_all()
RETURNS TABLE (protected integer, skipped text[])
LANGUAGE plpgsql AS $fn$
DECLARE
  t record;
  priv text;
  done integer := 0;
  missed text[] := ARRAY[]::text[];
  has_system boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jane_system');
  has_app boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jane_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jane_rls') THEN
    RAISE WARNING 'Row-level security is off: there is no jane_rls role';
    RETURN QUERY SELECT 0, ARRAY['(no jane_rls role)'];
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  -- Only what's missing: a run with nothing to do writes nothing, so two can't collide.
  IF NOT has_schema_privilege('jane_rls', 'public', 'USAGE') THEN
    GRANT USAGE ON SCHEMA public TO jane_rls;
  END IF;
  IF has_system THEN
    IF NOT has_schema_privilege('jane_system', 'public', 'USAGE') THEN
      GRANT USAGE ON SCHEMA public TO jane_system;
    END IF;
    FOR t IN SELECT c.oid, c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE c.relkind = 'S' LOOP
      IF NOT has_sequence_privilege('jane_system', t.oid, 'USAGE') THEN
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO jane_system', t.relname);
      END IF;
    END LOOP;
    IF NOT has_function_privilege('jane_system', 'jane_rls_plan()', 'EXECUTE') THEN
      GRANT EXECUTE ON FUNCTION jane_rls_plan() TO jane_system;
    END IF;
  END IF;
  IF has_app THEN
    BEGIN
      IF NOT pg_has_role('jane_app', 'jane_rls', 'MEMBER') THEN
        GRANT jane_rls TO jane_app;
      END IF;
      IF has_system AND NOT pg_has_role('jane_app', 'jane_system', 'MEMBER') THEN
        GRANT jane_system TO jane_app;
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'Could not let jane_app switch role: %', SQLERRM;
    END;
  END IF;
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
        -- Prisma's own bookkeeping stays the owner's.
        IF has_system AND t.table_name <> '_prisma_migrations'
          AND priv IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
          AND NOT has_table_privilege('jane_system', t.oid, priv) THEN
          EXECUTE format('GRANT %s ON %I TO jane_system', priv, t.table_name);
        END IF;
        IF has_app AND has_table_privilege('jane_app', t.oid, priv) THEN
          EXECUTE format('REVOKE %s ON %I FROM jane_app', priv, t.table_name);
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

SELECT * FROM jane_rls_protect_all();
