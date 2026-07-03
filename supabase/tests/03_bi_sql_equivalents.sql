-- BI measure validation — runs the three documented DAX-equivalent SQL
-- queries (docs/metabase-connection.md §4, mirroring the DAX measures in
-- docs/powerbi-connection.md §5) against a tiny seeded analytics_events
-- fixture and asserts the expected DAU / funnel / conversion-rate values.
--
-- `supabase test db` executes this against the local scratch database that
-- `supabase db start` built by replaying supabase/migrations/* from empty
-- (Docker runner only — the offline JS suite covers the token-parity half in
-- __tests__/bi-sql-equivalents-parity.test.ts). A typo in either doc's
-- formulas shows up here as a wrong number, before someone wires the measure
-- into a real dashboard.
--
-- Fixture timeline (all UTC):
--   u3: signup + item_added on 2026-06-20 (outside every 7-day window)
--   u1: signup 06-28; item_added + chat_opened + listing_created 06-29/30
--   u2: signup 06-30; item_added + listing_created 06-30
--   anonymous (user_id NULL): listing_created 06-30 — must not count anywhere
--   u1: premium_activated 2026-07-01 12:00 — the newest event, anchoring the
--       7-day window at (2026-06-24 12:00, 2026-07-01 12:00]

begin;
set local timezone = 'UTC';

select plan(3);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'bi-u1@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'bi-u2@test.dev'),
  ('00000000-0000-0000-0000-0000000000a3', 'bi-u3@test.dev');

insert into public.analytics_events (user_id, name, occurred_at) values
  ('00000000-0000-0000-0000-0000000000a3', 'signup_completed',  '2026-06-20T08:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a3', 'item_added',        '2026-06-20T09:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a1', 'signup_completed',  '2026-06-28T09:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a1', 'listing_created',   '2026-06-29T09:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a1', 'item_added',        '2026-06-30T09:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a1', 'chat_opened',       '2026-06-30T10:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a2', 'signup_completed',  '2026-06-30T08:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a2', 'item_added',        '2026-06-30T11:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a2', 'listing_created',   '2026-06-30T12:30:00Z'),
  (null,                                   'listing_created',   '2026-06-30T12:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a1', 'premium_activated', '2026-07-01T12:00:00Z');

-- 4.1 DAU — anonymous rows excluded, one row per active day, users deduped.
-- u1 has 2 events on 06-30 and u2 has 3; both count once. The NULL-user
-- listing on 06-30 must not appear (mirrors DAX `NOT ISBLANK`).
select results_eq(
  $q$
    SELECT
      date_trunc('day', occurred_at) AS day,
      count(DISTINCT user_id)::int   AS dau
    FROM analytics_events
    WHERE user_id IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  $q$,
  $e$ VALUES
    ('2026-06-20T00:00:00Z'::timestamptz, 1),
    ('2026-06-28T00:00:00Z'::timestamptz, 1),
    ('2026-06-29T00:00:00Z'::timestamptz, 1),
    ('2026-06-30T00:00:00Z'::timestamptz, 2),
    ('2026-07-01T00:00:00Z'::timestamptz, 1)
  $e$,
  'DAU series: distinct users per day, anonymous rows excluded');

-- 4.2 Listing-creation funnel — distinct *users*, so u1''s multiple events
-- count once and the anonymous listing_created does not inflate the numerator
-- (count(DISTINCT user_id) ignores NULLs). 2 listing users / 3 item users.
select results_eq(
  $q$
    SELECT
      count(DISTINCT user_id) FILTER (WHERE name = 'item_added')::int      AS items_added_users,
      count(DISTINCT user_id) FILTER (WHERE name = 'listing_created')::int AS listings_created_users,
      round(
        count(DISTINCT user_id) FILTER (WHERE name = 'listing_created')::numeric
          / NULLIF(count(DISTINCT user_id) FILTER (WHERE name = 'item_added'), 0),
        4
      ) AS listing_funnel_rate
    FROM analytics_events
  $q$,
  $e$ VALUES (3, 2, 0.6667::numeric) $e$,
  'listing funnel: 2 listing users / 3 item users = 0.6667');

-- 4.3 Premium conversion, 7-day window anchored to max(occurred_at)
-- (2026-07-01 12:00, mirrors DAX DATESINPERIOD). u3''s 06-20 signup falls
-- outside the 06-24 cutoff: 1 premium / 2 signups = 0.5.
select results_eq(
  $q$
    WITH last_seen AS (
      SELECT max(occurred_at) AS max_at FROM analytics_events
    )
    SELECT
      count(DISTINCT user_id) FILTER (WHERE name = 'signup_completed')::int  AS signups_7d,
      count(DISTINCT user_id) FILTER (WHERE name = 'premium_activated')::int AS premium_7d,
      round(
        count(DISTINCT user_id) FILTER (WHERE name = 'premium_activated')::numeric
          / NULLIF(count(DISTINCT user_id) FILTER (WHERE name = 'signup_completed'), 0),
        4
      ) AS premium_conversion_rate_7d
    FROM analytics_events, last_seen
    WHERE occurred_at > last_seen.max_at - interval '7 days'
  $q$,
  $e$ VALUES (2, 1, 0.5000::numeric) $e$,
  'premium conversion 7d: 1 premium / 2 in-window signups = 0.5');

select * from finish();

rollback;
