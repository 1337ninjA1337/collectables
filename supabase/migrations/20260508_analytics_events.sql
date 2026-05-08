-- analytics_events: server-side mirror of PostHog events.
--
-- We forward each PostHog event into this table via the
-- `analytics-mirror` Edge Function (see Analytics #13). The goal is to
-- own a long-tail event store independent of PostHog's free-tier
-- retention so Power BI / SQL queries can run over historical data.
--
-- Security model:
--   * The table is RLS-enabled.
--   * No SELECT / INSERT / UPDATE / DELETE policies are granted to the
--     `anon` or `authenticated` roles, so no end-user (logged-in or
--     not) can read or write rows. Power BI / Supabase SQL editor
--     queries must use the `service_role` key, which bypasses RLS.
--   * The `analytics-mirror` Edge Function authenticates with the
--     `service_role` key and inserts rows on behalf of PostHog.

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz   NOT NULL DEFAULT now(),
  user_id     uuid          NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  name        text          NOT NULL CHECK (length(name) > 0 AND length(name) <= 200),
  properties  jsonb         NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS analytics_events_occurred_at_idx
  ON public.analytics_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS analytics_events_name_occurred_idx
  ON public.analytics_events (name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS analytics_events_user_occurred_idx
  ON public.analytics_events (user_id, occurred_at DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Defensive: explicitly revoke privileges from anon + authenticated roles
-- so neither logged-out nor logged-in callers can touch the table even if
-- a future migration accidentally grants a permissive policy.
REVOKE ALL ON public.analytics_events FROM anon;
REVOKE ALL ON public.analytics_events FROM authenticated;

-- No CREATE POLICY statements here on purpose: RLS without any policy
-- denies all access to non-service roles, which is the desired posture.
-- Power BI / dashboards must use the service_role key, which bypasses RLS.
