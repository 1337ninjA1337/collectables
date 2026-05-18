# Power BI starter assets

Importable assets that get **DAU + the listing funnel + premium conversion**
running over the live `analytics_events` store with no DAX/M authoring.

The binary [`Collectables-Starter.pbit`](./Collectables-Starter.pbit) is
**generated** from these text assets by `scripts/build-powerbi-template.ts`
(`npm run build:powerbi`) — never hand-edited. CI cannot open Power BI
Desktop, so the binary is gated by a one-time human smoke-test
([`MANUAL-TASKS.md`](../../MANUAL-TASKS.md) → "Collectables-Starter.pbit").
The text assets stay the verifiable source of truth and the copy-paste
fallback if the template fails to open in your Power BI version.

## Files

| File | Use |
| --- | --- |
| [`Collectables-Starter.pbit`](./Collectables-Starter.pbit) | Double-click → opens in Power BI Desktop → prompts for the four Supabase parameters |
| [`queries.m`](./queries.m) | Fallback: Home → Transform data → New Query → Blank Query → Advanced Editor (replace all) |
| [`measures.dax`](./measures.dax) | Fallback: Modeling → New measure (one `Name :=` block at a time) |

## Quick start (template)

1. Double-click [`Collectables-Starter.pbit`](./Collectables-Starter.pbit).
2. Power BI prompts for `SupabaseHost` / `SupabasePort` / `SupabaseDb` /
   `SupabaseSchema` — paste your **session pooler** values.
3. Authenticate as the `service_role` (Database password) —
   `analytics_events` RLS denies `anon`/`authenticated`.
4. `DAU` / `ListingFunnelRate` / `PremiumConversionRate7d` are already in
   the model; drop them onto a visual with `occurred_at` on the axis.

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

## Regenerating

After editing `queries.m` or `measures.dax`, run `npm run build:powerbi` to
rebuild the `.pbit` and commit it. `__tests__/powerbi-template.test.ts`
fails CI if the committed binary drifts from the text sources.

## Cross-references

- Connection walkthrough, schema reference, refresh schedule:
  [`../powerbi-connection.md`](../powerbi-connection.md)
- Why the service-role key is required (RLS default-deny):
  [`../../supabase/migrations/20260508_analytics_events.sql`](../../supabase/migrations/20260508_analytics_events.sql)
  and [`../../MANUAL-TASKS.md`](../../MANUAL-TASKS.md)
- Event/property source of truth:
  [`../../lib/analytics-events.ts`](../../lib/analytics-events.ts)
- Platform decision record: [`../analytics-platform.md`](../analytics-platform.md)
