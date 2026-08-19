# Power BI starter assets

Importable assets that get **DAU + the listing funnel + premium conversion**
running over the live `analytics_events` store with no DAX/M authoring.

A binary [`Collectables-Starter.pbit`](./Collectables-Starter.pbit) ships
here (Analytics #15b). Open it in Power BI Desktop, it prompts for the four
`Supabase*` parameters, and the `analytics_events` model + all seven measures
are pre-wired — no DAX/M authoring. Regenerate it from the text assets below
with `npm run build:powerbi` (`scripts/build-powerbi-template.ts`); the build
is byte-deterministic and CI asserts the committed file matches the assets.

Because a hand-authored `.pbit` cannot be open-tested without Power BI
Desktop, these text assets remain the CI-verifiable source the `.pbit` is
built from — and the copy-paste fallback if the template fails to open in
your Power BI version.

## Files

| File | Use |
| --- | --- |
| [`Collectables-Starter.pbit`](./Collectables-Starter.pbit) | Open in Power BI Desktop → fill the parameter prompt → Connect |
| [`queries.m`](./queries.m) | Fallback: Home → Transform data → New Query → Blank Query → Advanced Editor (replace all) |
| [`measures.dax`](./measures.dax) | Fallback: Modeling → New measure (one `Name :=` block at a time) |

## Open the template

1. Double-click [`Collectables-Starter.pbit`](./Collectables-Starter.pbit)
   (or **File → Open** in Power BI Desktop).
2. Fill the parameter prompt with your **session pooler** values
   (`SupabaseHost`, `SupabasePort`, `SupabaseDb`, `SupabaseSchema`).
3. Authenticate as the `service_role` (Database password) — `analytics_events`
   RLS denies `anon`/`authenticated`.
4. The model loads with `DAU` / `ListingFunnelRate` / `PremiumConversionRate7d`
   already defined; drop them onto visuals with `occurred_at` on the X-axis.

> **Never save back over `Collectables-Starter.pbit`.** A template exported
> from Desktop carries the parameter values you just typed — host, database and
> the `service_role` password — inside its `DataModelSchema` part. Export to a
> `*.local.pbit` name instead: `*.local.*` is gitignored, so the file cannot be
> committed. `npm run lint:secrets` opens every committed `.pbit` and reads the
> parts inside it, so a filled-in one that lands here is caught rather than
> shipped — but not being able to make the mistake is better than catching it.

## Fallback (manual paste)

If the `.pbit` won't open in your Power BI version, build the same model by
hand from the text assets:

1. Open **Power BI Desktop** → blank report.
2. Copy [`queries.m`](./queries.m) to `queries.local.m` and edit the four
   parameter literals at the top (`SupabaseHost`, `SupabasePort`,
   `SupabaseDb`, `SupabaseSchema`) **in the copy** — `*.local.*` is
   gitignored, the tracked file is not.
3. **Home → Transform data → New Query → Blank Query**, open the **Advanced
   Editor**, replace its contents with `queries.local.m`, then **Close &
   Apply**. Authenticate as the `service_role` — `analytics_events` RLS denies
   `anon`/`authenticated`.
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
