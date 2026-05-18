# Power BI starter assets

Importable assets that get **DAU + the listing funnel + premium conversion**
running over the live `analytics_events` store with no DAX/M authoring.

The binary [`Collectables-Starter.pbit`](./Collectables-Starter.pbit)
template ships next to these files. It is **generated** from `queries.m` +
`measures.dax` by `scripts/build-powerbi-template.ts` (run
`tsx scripts/build-powerbi-template.ts` after editing either source; a CI
test fails if the committed `.pbit` is stale). Power BI Desktop is
Windows-only and cannot be run in CI, so the template's *contract* (valid
OPC ZIP, parameters surfaced, every measure embedded) is what the tests
verify — these text assets remain the guaranteed copy-paste fallback if the
template fails to open in your Power BI version.

## Files

| File | Use |
| --- | --- |
| [`Collectables-Starter.pbit`](./Collectables-Starter.pbit) | Double-click → Power BI prompts for the four Supabase params → Load |
| [`queries.m`](./queries.m) | Fallback: Home → Transform data → New Query → Blank Query → Advanced Editor (replace all) |
| [`measures.dax`](./measures.dax) | Fallback: Modeling → New measure (one `Name :=` block at a time) |

## Quick start (template)

1. Open **`Collectables-Starter.pbit`**. Power BI prompts for
   `SupabaseHost` / `SupabasePort` / `SupabaseDb` / `SupabaseSchema` — paste
   your **session pooler** values and authenticate as the `service_role`
   (`analytics_events` RLS denies `anon`/`authenticated`).
2. The `analytics_events` table + all seven measures (`DAU`,
   `ListingFunnelRate`, `PremiumConversionRate7d`, …) load ready to drop on
   a canvas.

## Fallback (manual paste)

1. Open **Power BI Desktop** → blank report.
2. **Home → Transform data → New Query → Blank Query**, open the **Advanced
   Editor**, and replace its contents with [`queries.m`](./queries.m).
3. Edit the four parameter literals at the top (`SupabaseHost`,
   `SupabasePort`, `SupabaseDb`, `SupabaseSchema`) with your **session
   pooler** values, then **Close & Apply**. Authenticate as the
   `service_role` — `analytics_events` RLS denies `anon`/`authenticated`.
4. **Modeling → New measure**, paste each block from
   [`measures.dax`](./measures.dax) (the `Name :=` line plus its expression).
5. Build visuals: `occurred_at` on the X-axis, `DAU` / `ListingFunnelRate` /
   `PremiumConversionRate7d` on the Y-axis.

## Cross-references

- Connection walkthrough, schema reference, refresh schedule:
  [`../powerbi-connection.md`](../powerbi-connection.md)
- Why the service-role key is required (RLS default-deny):
  [`../../supabase/migrations/20260508_analytics_events.sql`](../../supabase/migrations/20260508_analytics_events.sql)
  and [`../../MANUAL-TASKS.md`](../../MANUAL-TASKS.md)
- Event/property source of truth:
  [`../../lib/analytics-events.ts`](../../lib/analytics-events.ts)
- Platform decision record: [`../analytics-platform.md`](../analytics-platform.md)
