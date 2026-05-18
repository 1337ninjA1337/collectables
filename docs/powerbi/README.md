# Power BI starter assets

Importable assets that get **DAU + the listing funnel + premium conversion**
running over the live `analytics_events` store with no DAX/M authoring.

A binary [`Collectables-Starter.pbit`](./Collectables-Starter.pbit) template
is **generated from these text assets** by
`scripts/build-powerbi-template.ts` (run `npm run powerbi:template`). Open it
in Power BI Desktop and it prompts for the four `Supabase*` parameters, then
loads `analytics_events` with the seven starter measures pre-defined. Because
a hand-authored `.pbit` cannot be validated in CI without Power BI Desktop,
these text assets remain the **verifiable source of truth** and a guaranteed
copy-paste fallback if the template fails to open in your Power BI version.

## Files

| File | Use |
| --- | --- |
| [`Collectables-Starter.pbit`](./Collectables-Starter.pbit) | Power BI Desktop → **File → Open** → enter the four Supabase params when prompted |
| [`queries.m`](./queries.m) | Fallback: Home → Transform data → New Query → Blank Query → Advanced Editor (replace all) |
| [`measures.dax`](./measures.dax) | Fallback: Modeling → New measure (one `Name :=` block at a time) |

## Steps

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
