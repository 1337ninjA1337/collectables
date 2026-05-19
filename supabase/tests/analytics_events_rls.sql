-- analytics_events RLS verification (Analytics #16)
--
-- Proves the long-tail event store cannot be read by end users. The
-- 20260508_analytics_events.sql migration both REVOKEs ALL from anon /
-- authenticated *and* enables RLS with no policy (default-deny). This script
-- asserts BOTH defence layers from the perspective of each end-user role and
-- a positive control that a privileged connection can still read.
--
-- How to run (Supabase SQL editor runs as the `postgres` role, which can
-- SET ROLE to anon/authenticated; or psql with the service-role DB password):
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/analytics_events_rls.sql
--
-- Expected output: a NOTICE 'PASS: ...' for every check and a final
-- 'ALL ANALYTICS_EVENTS RLS CHECKS PASSED'. Any leak RAISEs EXCEPTION and
-- aborts. The whole script runs in a transaction that is ROLLED BACK, so the
-- probe row is never persisted.

BEGIN;

-- Seed a probe row as the (privileged) connection role so a leak would be
-- observable to anon/authenticated if RLS or the grants regressed.
INSERT INTO public.analytics_events (name)
VALUES ('__rls_probe_event__');

-- Reusable check: a given end-user role must NOT be able to read any row.
-- A pass is either (a) an insufficient_privilege error from the REVOKE, or
-- (b) the SELECT succeeds but RLS filters every row (count = 0). A non-zero
-- visible count is a leak and aborts the script.
DO $$
DECLARE
  r           text;
  leaked      bigint;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r);
      EXECUTE 'SELECT count(*) FROM public.analytics_events' INTO leaked;
      RESET ROLE;
      IF leaked <> 0 THEN
        RAISE EXCEPTION
          'LEAK: role % can SELECT % row(s) from analytics_events', r, leaked;
      END IF;
      RAISE NOTICE 'PASS: % SELECT returns 0 rows (RLS default-deny)', r;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        RAISE NOTICE 'PASS: % SELECT denied (REVOKE — insufficient_privilege)', r;
    END;

    -- Writes must be denied too: a compromised end-user token must not be
    -- able to forge or tamper with analytics history.
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r);
      EXECUTE
        'INSERT INTO public.analytics_events (name) VALUES (''__leak_write__'')';
      RESET ROLE;
      RAISE EXCEPTION 'LEAK: role % could INSERT into analytics_events', r;
    EXCEPTION
      WHEN insufficient_privilege OR check_violation THEN
        RESET ROLE;
        RAISE NOTICE 'PASS: % INSERT denied', r;
    END;
  END LOOP;
END $$;

-- Positive control: the privileged connection role (postgres / service_role)
-- must still see the probe row, otherwise the checks above would pass
-- vacuously even against an empty table.
DO $$
DECLARE
  visible bigint;
BEGIN
  SELECT count(*) INTO visible
  FROM public.analytics_events
  WHERE name = '__rls_probe_event__';
  IF visible <> 1 THEN
    RAISE EXCEPTION
      'positive control failed: privileged role sees % probe rows (expected 1)',
      visible;
  END IF;
  RAISE NOTICE 'PASS: privileged role can read analytics_events (control)';
  RAISE NOTICE 'ALL ANALYTICS_EVENTS RLS CHECKS PASSED';
END $$;

-- Never persist the probe row.
ROLLBACK;
