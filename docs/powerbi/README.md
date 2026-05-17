# Power BI starter assets

Importable assets that get **DAU + the listing funnel + premium conversion**
running over the live `analytics_events` store with no DAX/M authoring.

The fastest path is the pre-built template
[`Collectables-Starter.pbit`](./Collectables-Starter.pbit): double-click it,
fill the four parameter prompts (`SupabaseHost`, `SupabasePort`,
`SupabaseDb`, `SupabaseSchema`) with your **session pooler** values, and
authenticate as the `service_role`. It is generated deterministically by
`npm run build:pbit` (Analytics #15b, `scripts/build-powerbi-template.ts` →
`lib/pbit-template.ts`); the committed binary is byte-stable so rebuilds
don't churn git.

Because a hand-authored `.pbit` cannot be opened in CI without Power BI
Desktop, the text assets below are the verifiable source the `.pbit` is
built from — **and a copy-paste fallback** if the template fails to open in
your Power BI version.

## Files

| File | Paste into |
| --- | --- |
| [`Collectables-Starter.pbit`](./Collectables-Starter.pbit) | Double-click → fill the four parameter prompts (one-click path) |
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
