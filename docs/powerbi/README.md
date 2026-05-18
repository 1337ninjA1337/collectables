# Power BI starter assets

Importable assets that get **DAU + the listing funnel + premium conversion**
running over the live `analytics_events` store with no DAX/M authoring.

The shipped binary [`Collectables-Starter.pbit`](./Collectables-Starter.pbit)
(Analytics #15b) is the fastest path — open it, paste your Supabase session
pooler values into the four parameter prompts, authenticate as the
`service_role`, and DAU + the listing funnel + premium conversion load with
no DAX/M authoring. It is generated from the text assets below by
`scripts/build-powerbi-template.ts` (`npm run build:powerbi`); a
hand-authored `.pbit` cannot be opened/validated in CI without Power BI
Desktop, so the text assets are the verifiable source of truth — and a
copy-paste fallback if the template fails to open in your Power BI version.

## Files

| File | Use |
| --- | --- |
| [`Collectables-Starter.pbit`](./Collectables-Starter.pbit) | Open directly in Power BI Desktop — prompts for the 4 Supabase parameters on open |
| [`queries.m`](./queries.m) | Fallback: Home → Transform data → New Query → Blank Query → Advanced Editor (replace all) |
| [`measures.dax`](./measures.dax) | Fallback: Modeling → New measure (one `Name :=` block at a time) |

## Fastest path — open the `.pbit`

1. Double-click [`Collectables-Starter.pbit`](./Collectables-Starter.pbit)
   (or **File → Open** in Power BI Desktop).
2. At the parameter prompt, paste your **session pooler** values for
   `SupabaseHost`, `SupabasePort`, `SupabaseDb`, `SupabaseSchema`
   (Supabase → Settings → Database → Connection string → *Session pooler*).
3. Authenticate the PostgreSQL connection as the **`service_role`** —
   `analytics_events` RLS denies `anon`/`authenticated`.
4. The `analytics_events` table loads with all seven measures
   (`DAU` / `ItemsAdded` / `ListingsCreated` / `ListingFunnelRate` /
   `SignupsLast7d` / `PremiumActivationsLast7d` / `PremiumConversionRate7d`)
   already defined — drop them on visuals.

Regenerate the binary after editing the text assets:

```bash
npm run build:powerbi   # writes docs/powerbi/Collectables-Starter.pbit
```

## Fallback — paste the text assets manually

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
