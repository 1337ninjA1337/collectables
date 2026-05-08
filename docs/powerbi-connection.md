# Power BI — connecting to the Collectables analytics store

This guide walks through pointing **Power BI Desktop** at the
`public.analytics_events` table in Supabase (Analytics #12 schema, mirrored
from PostHog by the `analytics-mirror` Edge Function — Analytics #13). At the
end you'll have three sample DAX measures running over the live event store:
**DAU**, **listing-creation funnel**, and **premium-conversion rate**.

> Companion to [`docs/analytics-platform.md`](./analytics-platform.md). Read
> that first if you want the *why*; this one is the *how*.

## 1. Install Power BI Desktop (free)

Power BI Desktop is the free authoring tool. The paid Pro / Premium tiers are
for cloud sharing — for personal / single-author dashboards we don't need
either.

- **Windows**: <https://aka.ms/pbidesktopstore> (Microsoft Store, auto-updates)
  or <https://aka.ms/pbiSingleInstaller> (offline `.exe`).
- **macOS / Linux**: Power BI Desktop is Windows-only. On a Mac, use
  [Parallels](https://www.parallels.com/) or a Windows VM (UTM, VirtualBox).
  On Linux, run it under [Bottles](https://usebottles.com/) or a Windows VM.
- **Browser fallback**: <https://app.powerbi.com> renders existing reports but
  cannot author against a custom Postgres connection without a Pro license.

Verify the install: open Power BI Desktop → **Get data** → search "PostgreSQL".
The connector ships built-in; you do **not** need a separate Npgsql download
on recent versions.

## 2. Get the Supabase Postgres connection string

Supabase exposes the underlying Postgres via a connection pooler (PgBouncer).
For BI tools we want the **session pooler** because Power BI keeps a
long-lived connection during query refresh.

1. In the Supabase dashboard → **Project settings** → **Database** →
   **Connection string** → tab **Session pooler**.
2. Copy the host (`aws-0-<region>.pooler.supabase.com`), port (`5432`),
   database (`postgres`), and user (`postgres.<project-ref>`).
3. Reveal the **service-role** password under **Project settings** → **API** →
   **service_role secret**. Power BI must use this role because:
   - `anon` is RLS-default-denied on `analytics_events` (per Analytics #12).
   - `authenticated` is also RLS-default-denied on `analytics_events`.
   - Only `service_role` (and the Postgres superuser) can SELECT the table.

> ⚠️ The service-role key bypasses RLS for **every** table. Treat it like a
> root password: store in a password manager, never paste into a shared screen,
> and rotate via Supabase if ever exposed.

## 3. Connect Power BI to Supabase

In Power BI Desktop:

1. **Get data** → **PostgreSQL database** → **Connect**.
2. **Server**: `aws-0-<region>.pooler.supabase.com:5432` (host + port,
   colon-separated).
3. **Database**: `postgres`.
4. **Data Connectivity mode**: **DirectQuery** for live dashboards, or
   **Import** for snapshot reports refreshed on a schedule. Start with
   **Import** — DirectQuery hits the DB on every visual interaction and can
   blow through the free-tier connection budget.
5. Authentication: **Database** tab → username `postgres.<project-ref>`,
   password `<service-role-key>`.
6. **Encryption**: leave **Encrypt connections** checked. Supabase requires
   SSL.
7. Navigator → expand `public` → tick `analytics_events` → **Load**.

If the connector errors with `SSL connection has been closed unexpectedly`,
switch the SSL mode to **Require** in **File → Options → Global → DirectQuery
→ Allow unrestricted measures**. Recent Supabase pooler builds need it.

## 4. Schema reference — `public.analytics_events`

| Column        | Postgres type   | Notes                                                                |
| ------------- | --------------- | -------------------------------------------------------------------- |
| `id`          | `uuid`          | Primary key, `gen_random_uuid()` default. Treat as opaque in DAX.   |
| `occurred_at` | `timestamptz`   | Event time (ISO 8601 UTC). Use as the date axis on every visual.    |
| `user_id`     | `uuid` NULLable | FK → `auth.users.id`. NULL for anonymous PostHog distinct_ids.       |
| `name`        | `text`          | One of the typed-union values from `lib/analytics-events.ts`.        |
| `properties`  | `jsonb`         | Per-event payload; expand columns via Power Query JSON parse.       |

Indexes available to the planner:
- `analytics_events_occurred_at_idx (occurred_at DESC)` — date-range scans.
- `analytics_events_name_occurred_idx (name, occurred_at DESC)` — per-event
  histograms, e.g. listing-creation funnel.
- `analytics_events_user_occurred_idx (user_id, occurred_at DESC)` — DAU /
  retention slices.

### Expanding `properties` (jsonb)

Power Query: select the `properties` column → **Transform** → **Parse** →
**JSON** → expand the columns you need. A typical expansion:

| Event              | Useful property keys              |
| ------------------ | --------------------------------- |
| `signup_completed` | `method`, `provider`, `language`  |
| `listing_created`  | `mode`, `hasPrice`                |
| `premium_activated`| `source`                          |
| `chat_opened`      | `conversationId`, `withFriend`    |

The single source of truth for property shapes lives in
[`lib/analytics-events.ts`](../lib/analytics-events.ts) — keep this table in
sync when new props are added.

## 5. Three starter DAX measures

Add these in **Modeling → New measure**.

### 5.1 DAU (Daily Active Users)

```dax
DAU :=
CALCULATE (
    DISTINCTCOUNT ( analytics_events[user_id] ),
    NOT ( ISBLANK ( analytics_events[user_id] ) )
)
```

Drop `occurred_at` (Date hierarchy) on the X-axis and `DAU` on Y to get the
daily active-user line chart. The `NOT ISBLANK` filter excludes the
anonymous-distinct_id rows so the metric matches the PostHog dashboard.

### 5.2 Listing-creation funnel (item_added → listing_created)

```dax
ItemsAdded :=
CALCULATE (
    DISTINCTCOUNT ( analytics_events[user_id] ),
    analytics_events[name] = "item_added"
)

ListingsCreated :=
CALCULATE (
    DISTINCTCOUNT ( analytics_events[user_id] ),
    analytics_events[name] = "listing_created"
)

ListingFunnelRate :=
DIVIDE ( [ListingsCreated], [ItemsAdded] )
```

Visualise as a clustered column chart with the two raw measures + a line
overlay for `ListingFunnelRate` (formatted as percentage). The denominator is
*users who added an item*, not *items added*, so a power user adding 50 items
counts once.

### 5.3 Premium-conversion rate (signup → premium_activated, 7-day window)

```dax
SignupsLast7d :=
CALCULATE (
    DISTINCTCOUNT ( analytics_events[user_id] ),
    analytics_events[name] = "signup_completed",
    DATESINPERIOD (
        analytics_events[occurred_at],
        MAX ( analytics_events[occurred_at] ),
        -7,
        DAY
    )
)

PremiumActivationsLast7d :=
CALCULATE (
    DISTINCTCOUNT ( analytics_events[user_id] ),
    analytics_events[name] = "premium_activated",
    DATESINPERIOD (
        analytics_events[occurred_at],
        MAX ( analytics_events[occurred_at] ),
        -7,
        DAY
    )
)

PremiumConversionRate7d :=
DIVIDE ( [PremiumActivationsLast7d], [SignupsLast7d] )
```

The 7-day window matches the PostHog "Premium funnel" report so the two
dashboards line up. To run a longitudinal cohort instead (signup-day → ever
premium), drop the `DATESINPERIOD` filter on the numerator.

## 6. Refresh schedule

For **Import** mode:

1. **File → Options → Data Source Settings → Edit Permissions** to confirm
   the credentials are saved.
2. **Refresh** manually for now. Scheduled refresh requires **Power BI Pro**
   (\$10/user/month); for a single-author dashboard, a daily manual refresh is
   usually fine.
3. If the dataset grows past a few hundred MB, switch the model to
   **Incremental refresh** keyed on `occurred_at` so only new days are pulled.

For **DirectQuery** mode visuals refresh on every page interaction; bound
this with:
- **File → Options → Current file → Query reduction** → set max parallel
  connections to 4.
- Visual-level **Top N** filters to keep `analytics_events` queries bounded.

## 7. Screenshots

> Dashboard screenshots will be added here once the first build of
> `docs/powerbi/Collectables-Starter.pbit` (Analytics #15) lands. Until then,
> the DAX above renders directly inside Power BI Desktop without a template.

## 8. Related docs

- [`docs/analytics-platform.md`](./analytics-platform.md) — why this stack.
- [`MANUAL-TASKS.md`](../MANUAL-TASKS.md) — `analytics-mirror` Edge Function
  deployment + PostHog webhook configuration.
- [`supabase/migrations/20260508_analytics_events.sql`](../supabase/migrations/20260508_analytics_events.sql)
  — the `analytics_events` schema this guide reads from.
- [`lib/analytics-events.ts`](../lib/analytics-events.ts) — typed event
  taxonomy + property shapes.
