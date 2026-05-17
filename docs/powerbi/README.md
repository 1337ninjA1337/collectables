# Power BI starter assets

Importable assets that get **DAU + the listing funnel + premium conversion**
running over the live `analytics_events` store with no DAX/M authoring.

The binary [`Collectables-Starter.pbit`](./Collectables-Starter.pbit)
template (Analytics #15b) ships next to these files — open it, paste your
Supabase session-pooler host/port at the parameter prompt, and the DAU +
funnel pages render with no authoring. It is generated deterministically by
`scripts/build-powerbi-template.ts` (`npm run build:powerbi`) from the same
source as the model below; a hand-authored `.pbit` cannot be validated in CI
without Power BI Desktop, so these text assets stay as the verifiable source
**and** the copy-paste fallback if the template fails to open in your Power
BI version.

## Files

| File | Paste into |
| --- | --- |
| [`queries.m`](./queries.m) | Home → Transform data → New Query → Blank Query → Advanced Editor (replace all) |
| [`measures.dax`](./measures.dax) | Modeling → New measure (one `Name :=` block at a time) |

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
