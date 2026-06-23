-- BE-27 — `pg_cron` retention sweeps.
--
-- Three classes of data accumulate forever unless something prunes them:
--   1. analytics_events — the server-side PostHog mirror (20260508). We keep
--      ~13 months so Power BI / SQL can run year-over-year comparisons, then
--      drop the long tail. (matches the "~13 mo" window already floated in
--      the analytics privacy notes / BE-27.)
--   2. soft-delete tombstones — collections/items/profiles/friend_requests
--      rows with a non-NULL `deleted_at` (20260623). A tombstone only needs to
--      live long enough for every offline peer to delta-pull the deletion
--      (LWW conflict policy, docs/CONFLICT-POLICY.md). After a generous
--      90-day grace it is safe to hard-DELETE, reclaiming the row.
--   3. abandoned anonymous data — analytics_events with `user_id IS NULL`
--      (PostHog-generated anonymous distinct_ids that never resolved to a
--      signed-in account, see analytics-mirror). These carry no per-account
--      value, so they get the most aggressive 30-day window.
--
-- The sweeps live in one `SECURITY DEFINER` function, `run_retention_sweeps()`,
-- granted ONLY to `service_role` (it bypasses RLS to DELETE across tables and
-- must never be reachable by an anon/authenticated PostgREST session). pg_cron
-- runs jobs as the database owner, which satisfies that grant.
--
-- The windows are kept in sync with the public privacy policy
-- (APPSTORE-SUBMISSION.md → "Server-side data retention"). Changing a window
-- here means updating that paragraph too.
--
-- Idempotent to re-apply: `CREATE OR REPLACE FUNCTION`, idempotent GRANT/REVOKE,
-- and the cron (re)scheduling is guarded + unschedule-before-schedule.

-- ---------------------------------------------------------------------------
-- Retention windows (single source of truth — mirror into the privacy policy)
--   analytics_events (all)            : 13 months
--   analytics_events (anonymous/NULL) : 30 days
--   soft-delete tombstones            : 90 days
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_retention_sweeps()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
BEGIN
  -- (3) abandoned anonymous analytics — the most aggressive window. Run this
  -- BEFORE the 13-month sweep so the cheaper, larger anonymous set is gone
  -- first; the 13-month pass then only scans the per-account remainder.
  DELETE FROM public.analytics_events
   WHERE user_id IS NULL
     AND occurred_at < now() - interval '30 days';

  -- (1) analytics_events long tail — keep ~13 months for reporting.
  DELETE FROM public.analytics_events
   WHERE occurred_at < now() - interval '13 months';

  -- (2) soft-delete tombstones — hard-delete once the 90-day grace has passed
  -- on each user-deletable table (the inverse of the partial alive index).
  FOREACH t IN ARRAY ARRAY[
    'collections',
    'items',
    'profiles',
    'friend_requests'
  ]
  LOOP
    EXECUTE format(
      'DELETE FROM public.%I WHERE deleted_at IS NOT NULL '
      'AND deleted_at < now() - interval ''90 days''',
      t
    );
  END LOOP;
END;
$$;

-- Server-only: bypasses RLS to DELETE across tables; never expose to PostgREST
-- end-user roles.
REVOKE ALL ON FUNCTION public.run_retention_sweeps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_retention_sweeps() TO service_role;

-- Schedule a daily sweep at 03:00 UTC via pg_cron. pg_cron is an extension that
-- must be enabled once per project (Supabase: Database → Extensions → pg_cron,
-- or `CREATE EXTENSION pg_cron;` — see MANUAL-TASKS.md). If it is not installed
-- yet, this block is a no-op so the function + grants still apply cleanly; the
-- cron job can be (re)created by re-running this migration after enabling it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule first so re-applying the migration doesn't stack duplicate
    -- jobs on older pg_cron versions that don't upsert by name.
    PERFORM cron.unschedule('retention-sweeps')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention-sweeps');
    PERFORM cron.schedule(
      'retention-sweeps',
      '0 3 * * *',
      'SELECT public.run_retention_sweeps();'
    );
  END IF;
END $$;
