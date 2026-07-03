# Metabase — free fallback for the Collectables analytics store

Power BI Desktop is Windows-only ([`docs/powerbi-connection.md`](./powerbi-connection.md) §1
sends Mac/Linux engineers to a VM). **Metabase** is the free, cross-platform
fallback: it runs anywhere Docker or a JVM runs, reads the same
`public.analytics_events` table over the same Supabase session pooler, and its
scheduled dashboards are free (the Power BI equivalent needs a Pro license).
This guide reproduces the Power BI walkthrough — connection, schema, and the
three starter measures as plain SQL.

> Companion to [`docs/powerbi-connection.md`](./powerbi-connection.md). The
> connection values (§2 there) are identical; only the client differs.

## 1. Install Metabase (free, open source)

Pick one:

- **Docker** (recommended):

  ```bash
  docker run -d -p 3000:3000 --name metabase metabase/metabase
  ```

- **JAR** (any OS with Java 21+): download from
  <https://www.metabase.com/start/oss/jar> and run
  `java -jar metabase.jar`.

Open <http://localhost:3000> and complete the first-run wizard. The
open-source edition is free with no user or dashboard limits; the paid tiers
are for their managed cloud and SSO — not needed for a single-author setup.

## 2. Connect Metabase to Supabase

Run `npm run powerbi:conn` to print these values from your `.env` (the CLI is
client-agnostic despite the name). In Metabase: **Admin settings → Databases →
Add database → PostgreSQL**:

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Host         | `aws-0-<region>.pooler.supabase.com` (session pooler)     |
| Port         | `5432`                                                    |
| Database     | `postgres`                                                |
| Username     | `postgres.<project-ref>`                                  |
| Password     | service-role secret (dashboard → Project settings → API)  |
| SSL          | **Required** (Supabase rejects non-SSL connections)       |

Use the **session pooler**, not the transaction pooler — Metabase keeps
long-lived connections for its sync/scan jobs, same as Power BI's refresh.

> ⚠️ Same warning as the Power BI guide: `anon` and `authenticated` are
> RLS-default-denied on `analytics_events`, so Metabase must use the
> **service-role** password — which bypasses RLS for **every** table. Treat it
> like a root password and consider a read-only Postgres role if you share the
> Metabase instance.

After saving, Metabase syncs the schema; find the table under **Browse data →
postgres → Analytics Events**.

## 3. Schema reference

Identical to [`docs/powerbi-connection.md`](./powerbi-connection.md) §4 —
`id` (`uuid`), `occurred_at` (`timestamptz`), `user_id` (nullable `uuid`),
`name` (`text`), `properties` (`jsonb`). The per-event property keys are
generated into that doc's §4 table from
[`lib/analytics-events.ts`](../lib/analytics-events.ts); in Metabase you
expand `properties` with `properties ->> 'key'` in SQL instead of Power
Query's JSON parse.

## 4. The three starter measures as SQL

Metabase native questions (**+ New → SQL query**). These are the
DAX-equivalents of the Power BI guide's §5, same filters and windows so the
two dashboards line up.

### 4.1 DAU (Daily Active Users)

```sql
SELECT
  date_trunc('day', occurred_at) AS day,
  count(DISTINCT user_id)        AS dau
FROM analytics_events
WHERE user_id IS NOT NULL -- exclude anonymous distinct_ids, matching PostHog
GROUP BY 1
ORDER BY 1;
```

Visualise as a line chart (`day` on X, `dau` on Y).

### 4.2 Listing-creation funnel (item_added → listing_created)

```sql
SELECT
  count(DISTINCT user_id) FILTER (WHERE name = 'item_added')      AS items_added_users,
  count(DISTINCT user_id) FILTER (WHERE name = 'listing_created') AS listings_created_users,
  round(
    count(DISTINCT user_id) FILTER (WHERE name = 'listing_created')::numeric
      / NULLIF(count(DISTINCT user_id) FILTER (WHERE name = 'item_added'), 0),
    4
  ) AS listing_funnel_rate
FROM analytics_events;
```

The denominator is *users who added an item*, not *items added* — a power
user adding 50 items counts once, matching the DAX `DISTINCTCOUNT`.

### 4.3 Premium-conversion rate (signup → premium_activated, 7-day window)

```sql
WITH last_seen AS (
  SELECT max(occurred_at) AS max_at FROM analytics_events
)
SELECT
  count(DISTINCT user_id) FILTER (WHERE name = 'signup_completed')  AS signups_7d,
  count(DISTINCT user_id) FILTER (WHERE name = 'premium_activated') AS premium_7d,
  round(
    count(DISTINCT user_id) FILTER (WHERE name = 'premium_activated')::numeric
      / NULLIF(count(DISTINCT user_id) FILTER (WHERE name = 'signup_completed'), 0),
    4
  ) AS premium_conversion_rate_7d
FROM analytics_events, last_seen
WHERE occurred_at > last_seen.max_at - interval '7 days';
```

The window is anchored to the newest event (`MAX(occurred_at)`), mirroring the
DAX `DATESINPERIOD` version, so both tools report the same number on a stale
dataset.

## 5. Refresh schedule

Nothing to buy here — this is where Metabase beats Power BI's free tier:

- Questions run live against Postgres on every view; **Admin → Databases →
  postgres → Sync and scan** controls the metadata refresh cadence.
- Dashboard **subscriptions** (hourly/daily email or Slack) are free.
- Add caching under **Admin → Performance** if the free-tier Supabase pooler
  starts feeling the query load; the indexes listed in the Power BI guide §4
  (`occurred_at`, `(name, occurred_at)`, `(user_id, occurred_at)`) serve these
  three queries.

## 6. Related docs

- [`docs/powerbi-connection.md`](./powerbi-connection.md) — the Power BI
  original this guide mirrors (schema reference + generated property table).
- [`docs/analytics-platform.md`](./analytics-platform.md) — why this stack.
- [`supabase/migrations/20260508_analytics_events.sql`](../supabase/migrations/20260508_analytics_events.sql)
  — the `analytics_events` schema both guides read from.
- [`lib/analytics-events.ts`](../lib/analytics-events.ts) — typed event
  taxonomy + property shapes.
