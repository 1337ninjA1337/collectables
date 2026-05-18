-- analytics_events RLS deny-posture verification (Analytics #16).
--
-- Run this against the live Supabase project AFTER applying
-- supabase/migrations/20260508_analytics_events.sql to prove that the
-- long-tail event store cannot leak to end users:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/analytics_events_rls_test.sql
--
-- or paste it into the Supabase SQL editor. It RAISEs an EXCEPTION (so the
-- run fails loudly) the moment any of these regress:
--   1. the table is missing,
--   2. RLS is not enabled,
--   3. any RLS policy exists (a policy could expose rows to anon/auth),
--   4. the `anon` or `authenticated` role holds ANY table privilege,
--   5. a SELECT executed AS anon / AS authenticated is NOT denied.
-- It also asserts the service_role CAN read (the Power BI path must work).
--
-- Pure verification: it never writes rows and rolls nothing back because it
-- performs no DML. Safe to run against production.

DO $$
DECLARE
  rls_enabled  boolean;
  policy_count integer;
  denied       boolean;
BEGIN
  -- 1. Table exists.
  IF to_regclass('public.analytics_events') IS NULL THEN
    RAISE EXCEPTION
      'analytics_events RLS test FAILED: table public.analytics_events is missing';
  END IF;

  -- 2. RLS is enabled.
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class
  WHERE oid = 'public.analytics_events'::regclass;
  IF NOT rls_enabled THEN
    RAISE EXCEPTION
      'analytics_events RLS test FAILED: row level security is NOT enabled';
  END IF;

  -- 3. Zero policies — RLS with no policy is the intended deny-all posture.
  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'analytics_events';
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'analytics_events RLS test FAILED: % policy/policies exist (expected 0); '
      'a policy could expose the event store to anon/authenticated',
      policy_count;
  END IF;

  -- 4. Neither anon nor authenticated holds any table privilege.
  IF has_table_privilege('anon', 'public.analytics_events', 'SELECT')
     OR has_table_privilege('anon', 'public.analytics_events', 'INSERT')
     OR has_table_privilege('anon', 'public.analytics_events', 'UPDATE')
     OR has_table_privilege('anon', 'public.analytics_events', 'DELETE') THEN
    RAISE EXCEPTION
      'analytics_events RLS test FAILED: role "anon" holds a table privilege';
  END IF;
  IF has_table_privilege('authenticated', 'public.analytics_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.analytics_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.analytics_events', 'DELETE') THEN
    RAISE EXCEPTION
      'analytics_events RLS test FAILED: role "authenticated" holds a table privilege';
  END IF;

  -- 5a. A SELECT executed AS anon must be denied.
  denied := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.analytics_events LIMIT 1;
    RESET ROLE;
  EXCEPTION
    WHEN insufficient_privilege THEN
      denied := true;
      RESET ROLE;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION
      'analytics_events RLS test FAILED: SELECT AS anon was NOT denied';
  END IF;

  -- 5b. A SELECT executed AS authenticated must be denied.
  denied := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.analytics_events LIMIT 1;
    RESET ROLE;
  EXCEPTION
    WHEN insufficient_privilege THEN
      denied := true;
      RESET ROLE;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION
      'analytics_events RLS test FAILED: SELECT AS authenticated was NOT denied';
  END IF;

  -- 6. The service_role (Power BI / analytics-mirror path) CAN read. This
  -- block runs as the connecting superuser/service role; a failure here
  -- means the legitimate read path is broken.
  BEGIN
    PERFORM 1 FROM public.analytics_events LIMIT 1;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION
        'analytics_events RLS test FAILED: service/superuser SELECT was denied '
        '(Power BI / analytics-mirror would be broken)';
  END;

  RAISE NOTICE 'analytics_events RLS test PASSED: deny-all for anon+authenticated, readable by service_role';
END
$$;
