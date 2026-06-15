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
