-- Analytics #16 — RLS leakage test for public.analytics_events.
--
-- Verifies that the long-tail event store cannot be read by end users.
-- Run this in the Supabase SQL editor (which connects as a RLS-bypassing
-- role) AFTER applying supabase/migrations/20260508_analytics_events.sql.
--
-- It seeds one probe row, asserts that BOTH the `anon` and the
-- `authenticated` role are denied SELECT (the migration's `REVOKE ALL`
-- removes the table grant, so PostgreSQL raises insufficient_privilege
-- before RLS is even consulted), confirms the RLS-bypassing role CAN still
-- read it (so Power BI / the analytics-mirror function keep working), then
-- ROLLBACKs so the probe row never persists.
--
-- Expected output: three `OK: …` NOTICEs and a successful ROLLBACK. Any
-- `SECURITY FAIL: …` exception means the event store is leaking — treat it
-- as a release blocker.

BEGIN;

-- Probe row, inserted in the RLS-bypassing editor context.
INSERT INTO public.analytics_events (name, properties)
VALUES ('__rls_probe__', '{"probe": true}'::jsonb);

-- 1. anon must NOT be able to SELECT.
DO $$
BEGIN
  SET LOCAL ROLE anon;
  PERFORM 1 FROM public.analytics_events LIMIT 1;
  RESET ROLE;
  RAISE EXCEPTION 'SECURITY FAIL: anon can SELECT public.analytics_events';
EXCEPTION
  WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'OK: anon SELECT denied (insufficient_privilege)';
END $$;

-- 2. authenticated must NOT be able to SELECT either.
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM 1 FROM public.analytics_events LIMIT 1;
  RESET ROLE;
  RAISE EXCEPTION 'SECURITY FAIL: authenticated can SELECT public.analytics_events';
EXCEPTION
  WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'OK: authenticated SELECT denied (insufficient_privilege)';
END $$;

-- 3. The RLS-bypassing role (service_role / Power BI / SQL editor) MUST
--    still be able to read, otherwise the analytics pipeline is broken.
DO $$
DECLARE
  probe_count integer;
BEGIN
  SELECT count(*) INTO probe_count
  FROM public.analytics_events
  WHERE name = '__rls_probe__';
  IF probe_count < 1 THEN
    RAISE EXCEPTION 'SECURITY FAIL: service_role cannot read public.analytics_events';
  END IF;
  RAISE NOTICE 'OK: service_role can read public.analytics_events (% probe row(s))', probe_count;
END $$;

-- Read-only assertion: discard the probe row.
ROLLBACK;
