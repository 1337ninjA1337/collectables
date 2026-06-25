# Deploying to GitHub Pages

The web build for this app is deployed automatically by
`.github/workflows/deploy.yml`. Every push to `main` builds the Expo web bundle
with `npx expo export --platform web`, copies `index.html` to `404.html`
(so client-side routes survive a refresh), and publishes the result to the
`main` branch via `peaceiris/actions-gh-pages`.

The workflow needs runtime credentials at build time. Without them the
deployed site renders disabled login buttons because
`process.env.EXPO_PUBLIC_*` is empty in the bundled JS — supply the secrets
listed below before deploying.

## Adding the required secrets

In the GitHub UI for this repository:

1. Go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret** for each of the values below, copying the
   value from your local `.env` file. Names and values must match exactly.

| Secret name                                  | Source (`.env` key)                        | Notes |
| -------------------------------------------- | ------------------------------------------ | ----- |
| `EXPO_PUBLIC_SUPABASE_URL`                   | `EXPO_PUBLIC_SUPABASE_URL`                 | Required for auth + cloud sync |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`       | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`     | Required for auth + cloud sync |
| `EXPO_PUBLIC_CLOUDINARY_URL`                 | `EXPO_PUBLIC_CLOUDINARY_URL`               | Optional. Full REST base, e.g. `https://api.cloudinary.com/v1_1/<cloud-name>`. If omitted, the cloud name below is used. |
| `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`          | `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`        | Optional. Falls back to the bundled default. |
| `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET`       | `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET`     | Optional. Falls back to the bundled default. |
| `EXPO_PUBLIC_SENTRY_DSN`                     | `EXPO_PUBLIC_SENTRY_DSN`                   | Optional. Sentry crash-reporting DSN. When empty, the SDK skips initialisation and `captureException` becomes a no-op. |
| `EXPO_PUBLIC_SENTRY_ENV`                     | `EXPO_PUBLIC_SENTRY_ENV`                   | Optional. One of `development`, `staging`, `production`. Defaults to `production` for the deploy workflow; `development` disables event reporting entirely. |
| `EXPO_PUBLIC_POSTHOG_KEY`                    | `EXPO_PUBLIC_POSTHOG_KEY`                  | Optional. PostHog project API key (Settings → Project → Project API Key). When empty, analytics SDK skips initialisation. |
| `EXPO_PUBLIC_POSTHOG_HOST`                   | `EXPO_PUBLIC_POSTHOG_HOST`                 | Optional. PostHog ingestion host. Defaults to `https://eu.posthog.com` (EU cloud). Override to `https://us.i.posthog.com` for US cloud or a self-hosted URL. |
| `EXPO_PUBLIC_CLARITY_PROJECT_ID`             | `EXPO_PUBLIC_CLARITY_PROJECT_ID`           | Optional. Microsoft Clarity project ID for web-only session replay. When empty, the Clarity script is not injected. |
| `EXPO_PUBLIC_PROFILE_CACHE_TTL_MS`           | `EXPO_PUBLIC_PROFILE_CACHE_TTL_MS`         | Optional. Viewer-profile cache TTL in milliseconds. Defaults to `600000` (10 min). Values below `30000` (30 s) trigger a one-shot in-app warning toast because aggressive overrides hammer Supabase free-tier rate limits. |
| `EXPO_PUBLIC_REALTIME_DISABLED`              | `EXPO_PUBLIC_REALTIME_DISABLED`            | Optional. Set to `1`, `true`, or `yes` to make `getSharedRealtimeClient()` return `null` regardless of whether Supabase is configured — drops all realtime WebSocket traffic (chat inbox, marketplace updates) without redeploying. Useful for incident response and offline-only QA. |
| `EXPO_PUBLIC_ANALYTICS_DISABLED`             | `EXPO_PUBLIC_ANALYTICS_DISABLED`           | Optional. Set to `1`, `true`, or `yes` to force `AnalyticsConfig.enabled` to `false` — disables PostHog *and* Microsoft Clarity regardless of whether the keys are present. Lets an operator drop all third-party tracking by flipping a GitHub secret and re-running the deploy, with no code change. Useful for incident response (e.g. a broken analytics SDK or a privacy hold). |
| `EXPO_PUBLIC_LANGUAGE_CURRENCY`              | `EXPO_PUBLIC_LANGUAGE_CURRENCY`            | Optional. Per-language currency override in the format `lang:CODE,lang:CODE` (e.g. `ru:RUB,en:EUR`). Each entry replaces the bundled default in `lib/locale-helpers.ts` (ru→RUB, be→BYN, de→EUR, pl→PLN, es→EUR, en→USD); unmentioned languages keep their canonical currency. Currency codes are upper-cased; invalid tokens are silently dropped. Lets QA flip per-region defaults for localized launches without a code change. |

The deploy workflow also pins `EXPO_PUBLIC_APP_URL` to the public site URL so
deep links resolve correctly even when shared from a sub-route.

A tracked [`.env.example`](./.env.example) ships at the repo root with the same
list of variables as placeholders — copy it to `.env` and fill in real values
to run the app locally.

## Manual rerun

If you change a secret, trigger a new deploy by either pushing a no-op commit
to `main` or by going to **Actions → Deploy to GitHub Pages → Run workflow**.

## Native (iOS / App Store) deploys

GitHub Pages only covers the web target. For an iOS App Store submission,
follow the end-to-end checklist in [`APPSTORE-SUBMISSION.md`](./APPSTORE-SUBMISSION.md)
— it covers Apple Developer enrolment, required `app.json` additions,
visual assets, App Store Connect listing copy, EAS build/submit, and the
TestFlight + review flow.


## Database migrations & local schema testing

The committed `supabase/migrations/*` files are the authoritative schema. Two
checks keep them honest:

- **Supabase Tests** (`.github/workflows/supabase-test.yml`) runs on every PR
  that touches `supabase/**`. It boots a throwaway local Postgres with
  `supabase db start` (applying every migration from empty, in filename order,
  against a real `auth` schema) and then runs the pgTAP suite in
  `supabase/tests/*.sql` with `supabase test db`. No secrets — the database is
  ephemeral and local to the runner.
- **Supabase Migrations** (`.github/workflows/supabase-migrations.yml`) pushes
  pending migrations to the live database on `main` (gated on `SUPABASE_DB_URL`).

To reproduce the PR check locally (needs Docker + the
[Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
supabase init       # generates a local supabase/config.toml (git-ignored)
supabase db start   # applies supabase/migrations/* to a scratch local DB
supabase test db    # runs supabase/tests/*.sql (pgTAP)
supabase stop --no-backup
```

> **Do not commit `supabase/config.toml`.** It is git-ignored on purpose: the
> repo's Supabase Branching integration treats a committed `config.toml` as the
> source of truth for the preview/production projects, so a partial one would
> stop deploying undeclared edge functions and override dashboard-managed
> settings on merge. The CI workflow generates a throwaway config on the runner
> for exactly this reason.

## Bootstrapping a fresh Supabase project from committed migrations

Use this to stand up a brand-new (or throwaway/staging) Supabase project from
nothing but the files committed to this repo — no dashboard clicking through
table editors, no hand-copied SQL beyond running the migrations in order. The
committed `supabase/migrations/*` are the single source of truth; the steps
below reproduce the production schema end-to-end on an empty project.

> This needs a live Supabase login (project creation + connection string), so
> it cannot be exercised from CI. The CI **Supabase Tests** job
> (`supabase-test.yml`) already proves the same migrations replay cleanly from
> empty against a local Postgres — this section is the human-driven equivalent
> against a real hosted project.

1. **Create the project.** Supabase Dashboard → **New project**. Pick a region
   and a strong database password (store it in your password manager — you need
   it for the connection string below). Wait for provisioning to finish.

2. **Grab the credentials** from **Settings → API**:
   - Project URL → `EXPO_PUBLIC_SUPABASE_URL`
   - `anon` / publishable key → `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

   And the **session-pooler** connection string from **Settings → Database →
   Connection string → URI** (include the password):
   `postgresql://postgres:<password>@<host>:5432/postgres`.

3. **Apply every migration, in filename order**, against the empty project.
   Easiest with the Supabase CLI (Docker not required for a remote push):

   ```bash
   supabase link --project-ref <project-ref>   # from the project URL/Settings
   supabase db push                            # applies supabase/migrations/* in order
   ```

   `supabase db push` walks the migrations lexicographically — which is exactly
   their dependency order. The earliest, `20260423_base_schema.sql`, must run
   before `20260424_chat_messages.sql` (whose RLS policy references
   `friend_requests`); the filename dates already guarantee this. The full set,
   in apply order, is:

   ```text
   20260423_base_schema.sql              core tables (profiles/collections/items/friend_requests)
   20260424_chat_messages.sql            chat
   20260501_chat_reads.sql               chat read receipts
   20260502_marketplace_listings.sql     marketplace
   20260507_marketplace_buyer_user_id.sql
   20260508_analytics_events.sql         analytics sink
   20260516_chat_id_integrity.sql
   20260517_items_cost_currency.sql
   20260523_collection_currency.sql
   20260527142510_items_archived_at.sql
   20260527_marketplace_transfers.sql
   20260528_profile_display_currency.sql
   20260616_core_tables_rls.sql          RLS + helpers on the core tables
   20260617_profiles_admin_update_grant.sql  hardens is_admin against self-promotion
   20260618_fk_on_delete_cascade.sql     explicit ON DELETE CASCADE on the core FKs
   20260619_integrity_checks.sql         backfill visibility/condition/no-self CHECKs + pair unique
   20260620_fk_index_coverage.sql        index the one unindexed FK (chat_messages.from_user_id)
   20260621_updated_at_moddatetime.sql   updated_at + moddatetime auto-bump trigger on every table
   20260622_not_null_defaults.sql        backfill NOT NULL + defaults on client-guaranteed columns
   20260623_soft_delete_deleted_at.sql   nullable deleted_at + partial alive index on deletable tables
   20260624_accept_friend_request.sql    transactional accept_friend_request() fn (service_role-only)
   20260625_subscriptions.sql            server-authoritative subscriptions table (service_role writes only)
   20260626_realtime_replica_identity.sql  REPLICA IDENTITY FULL + realtime publication for collections/items/marketplace (UPDATE/DELETE events)
   20260627_retention_sweeps.sql         pg_cron daily retention sweeps (analytics 13mo, anon 30d, tombstones 90d)
   20260628_marketplace_arrived_at.sql   adds the missing marketplace_listings.arrived_at column (read-projection drift fix)
   ```

   No CLI? Open each file in **SQL Editor** and run them top-to-bottom in the
   order above — every migration is idempotent (`IF NOT EXISTS` / `DROP …
   IF EXISTS` / `CREATE OR REPLACE`), so a re-run is safe. There is **no seed
   step**: the app falls back to `data/seed.ts` locally and writes real rows
   once a user signs in.

4. **Deploy the Edge Functions** the app calls (each has setup notes in
   [`MANUAL-TASKS.md`](./MANUAL-TASKS.md)):

   ```bash
   supabase functions deploy delete-account
   supabase functions deploy delete-image      # SEC-1, security-critical
   supabase functions deploy analytics-mirror
   supabase functions deploy claim-listing          # BE-20, atomic buyer claim
   supabase functions deploy accept-friend-request  # BE-21, transactional accept
   supabase functions deploy validate-premium       # BE-22b, server-authoritative premium
   supabase functions deploy export-data            # BE-26, GDPR data export
   ```

5. **Point a build at the new project.** For a throwaway/staging deploy, set
   `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in your
   local `.env` (see [Adding the required secrets](#adding-the-required-secrets)
   for the full list) and run `npm run build`, or update the two GitHub Actions
   secrets and let `deploy.yml` rebuild. The bundled JS reads
   `process.env.EXPO_PUBLIC_*` at build time — there is nothing else to wire up.

6. **Confirm end-to-end** against the fresh project:
   - Sign in via the email-OTP flow (proves `auth` + the `profiles` upsert).
   - Create a collection, then an item with a cost + currency (proves
     `collections`/`items` writes and the currency columns).
   - From a second account, send a friend request and accept it (proves
     `friend_requests` + the RLS visibility helpers from
     `20260616_core_tables_rls.sql`).
   - Confirm a non-friend cannot see a private collection (RLS deny path).

   If all four pass, the migrations reproduce the full schema and the build is
   correctly pointed at the new project.
