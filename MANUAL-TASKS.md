# Manual Tasks

These DB changes must be applied manually to the Supabase project (or will be auto-applied via the `supabase db push` CI step if `SUPABASE_DB_URL` secret is set).

## Migrations: free, main-only setup (no Supabase Branching)

Supabase **Branching** (the "Supabase Preview" check) is a paid feature. To stay
on the free plan and use only the production database tied to `main`:

1. **Disable Branching** so the paid "Supabase Preview" check stops running:
   Supabase Dashboard → **Branches** → disable/turn off Branching (or disconnect
   the GitHub Branching integration). This removes the red `Supabase / Supabase
   Preview` check entirely; it does not touch your production database.

2. **(Optional) Enable free automatic migrations on `main`.** The workflow
   `.github/workflows/supabase-migrations.yml` runs `supabase db push` against
   production whenever a migration changes on `main`. To turn it on, add one
   GitHub Actions secret:
   - **Name:** `SUPABASE_DB_URL`
   - **Value:** your production Postgres connection string —
     Dashboard → **Settings → Database → Connection string → URI** (use the
     pooler/session URI and include the password). Format:
     `postgresql://postgres:<password>@<host>:5432/postgres`
   - Add it under **Settings → Secrets and variables → Actions** in GitHub.

   The workflow is opt-in: with no secret it skips cleanly (stays green). With
   the secret set, pending migrations apply to production automatically on every
   push to `main`. **Never commit this connection string** — it lives only in
   GitHub Secrets.

   Until you add the secret (or instead of it), keep applying each migration's
   SQL manually via the Supabase SQL editor as documented in the sections below.

## 20260423_base_schema.sql

Authoritative, idempotent definition of the four core tables (`profiles`,
`collections`, `items`, `friend_requests`). It folds every earlier `ALTER`
(`items.cost_currency`, `collections.currency`, `items.archived_at`,
`profiles.display_currency`) into a single `CREATE TABLE … IF NOT EXISTS`
definition so a **fresh** Supabase project can be bootstrapped from the
committed migrations alone.

```sql
-- Creates public.profiles / collections / items / friend_requests with all
-- columns, foreign keys (→ auth.users, items → collections), uniqueness on
-- profiles.public_id / profiles.username, the friend_requests directed-pair
-- unique index + no-self CHECK, and hot-path indexes. Every statement uses
-- IF NOT EXISTS, so it is SAFE to apply on top of the existing live schema:
-- pre-existing tables/columns are left untouched, missing ones are added.
```

- **Fresh project:** apply this migration first (it is dated `20260423`,
  before the earliest dependent migration `20260424_chat_messages.sql` whose
  RLS policy references `friend_requests`, so `supabase db push` runs it in
  order and the from-empty replay succeeds).
- **Existing project:** applying it is a no-op for anything already present;
  the embedded `ADD COLUMN IF NOT EXISTS` guards re-assert the four ALTERs.

Either apply it via the Supabase SQL editor, or push via the `supabase db push`
workflow. RLS lockdown for these tables is a separate, later migration
(BE-11/BE-12) — this one only establishes column shape, keys, and FKs.

## 20260527142510_items_archived_at.sql

Run `supabase/migrations/20260527142510_items_archived_at.sql` against your Supabase project to support soft-archiving of items after a marketplace sale:

```sql
-- Adds public.items.archived_at column (timestamptz, nullable).
-- Items with archived_at != NULL stop appearing in collection lists, totals,
-- recent items and search — but remain in storage for stats / audit.
```

Either apply it via the Supabase SQL editor, or push via the `supabase db push` workflow.

## 20260502_marketplace_listings.sql

Run `supabase/migrations/20260502_marketplace_listings.sql` against your Supabase project:

```sql
-- Creates public.marketplace_listings table with RLS policies:
--   * Any authenticated user can SELECT listings
--   * Users can only INSERT/UPDATE/DELETE their own listings
```

Either apply it via the Supabase SQL editor, or add the `SUPABASE_DB_URL` secret to GitHub and the deploy workflow will run `supabase db push` automatically.

## 20260507_marketplace_buyer_user_id.sql

Run `supabase/migrations/20260507_marketplace_buyer_user_id.sql` against your Supabase project to enable buyer-driven marketplace transfers (full trading cycle):

```sql
-- Adds public.marketplace_listings.buyer_user_id column (nullable, FK -> auth.users)
-- and an index on it.
-- Adds an UPDATE RLS policy so an authenticated non-owner can mark an active
-- listing as sold by setting (buyer_user_id = auth.uid(), sold_at = now()).
```

Either apply it via the Supabase SQL editor, or push via the `supabase db push` workflow.

## 20260508_analytics_events.sql

Run `supabase/migrations/20260508_analytics_events.sql` against your Supabase project to create the long-tail event store mirrored from PostHog (Analytics #12):

```sql
-- Creates public.analytics_events(id, occurred_at, user_id, name, properties jsonb).
-- RLS is ENABLED with NO policies: neither anon nor authenticated callers can
-- read or write rows. Inserts must be performed with the service_role key
-- (used by the analytics-mirror Edge Function and by Power BI / SQL queries).
-- Indexes: occurred_at DESC, (name, occurred_at DESC), (user_id, occurred_at DESC).
```

Either apply it via the Supabase SQL editor, or push via the `supabase db push` workflow.

### RLS leak check (Analytics #16)

After applying the migration, paste this into the Supabase SQL editor to prove
the long-tail event store is **not** readable by end users. `analytics_events`
has `REVOKE ALL` from `anon`/`authenticated` **and** RLS-with-no-policy, so both
roles must be rejected — only the `service_role` (Power BI / SQL editor) reads
it:

```sql
-- 1. Anonymous (logged-out) caller — MUST raise:
--    ERROR: permission denied for table analytics_events
SET ROLE anon;
SELECT count(*) FROM public.analytics_events;
RESET ROLE;

-- 2. Authenticated (logged-in end user) — MUST raise the same
--    permission-denied error:
SET ROLE authenticated;
SELECT count(*) FROM public.analytics_events;
RESET ROLE;

-- 3. service_role bypasses RLS and DOES see rows (sanity, expect a count):
SET ROLE service_role;
SELECT count(*) AS service_role_visible_rows FROM public.analytics_events;
RESET ROLE;
```

Pass criteria: steps 1 and 2 each fail with `permission denied for table
analytics_events` (SQLSTATE `42501`); step 3 returns a row count. If step 1 or 2
returns a number instead of erroring, a later migration has wrongly granted a
policy/privilege — treat it as a data-leak regression and revert it.

## 20260516_chat_id_integrity.sql

Run `supabase/migrations/20260516_chat_id_integrity.sql` against your Supabase project to enforce chat-message conversation-key integrity:

```sql
-- Adds a CHECK constraint (chat_messages_chat_id_matches_participants, NOT VALID)
-- so chat_id MUST equal 'chat-' || least(from,to) || '-' || greatest(from,to).
-- Enforced for every new INSERT; pre-existing rows are not re-checked so the
-- migration is safe to apply to a live DB.
```

Either apply it via the Supabase SQL editor, or push via the `supabase db push` workflow.

Optional hardening — after confirming no historical row violates the rule:

```sql
SELECT id, chat_id FROM public.chat_messages
WHERE chat_id <> 'chat-'
  || least(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C")
  || '-'
  || greatest(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C");
-- If the above returns 0 rows, extend the guarantee to all rows:
ALTER TABLE public.chat_messages
  VALIDATE CONSTRAINT chat_messages_chat_id_matches_participants;
```

## analytics-mirror Edge Function (Analytics #13)

Deploy the `supabase/functions/analytics-mirror/index.ts` Edge Function and configure PostHog to forward webhooks to it.

### 1. Deploy the function

```bash
supabase functions deploy analytics-mirror --project-ref <your-project-ref>
```

### 2. Set the function secrets

```bash
supabase secrets set --project-ref <your-project-ref> \
  POSTHOG_WEBHOOK_SECRET=<paste a long random string here>
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.
```

Generate the secret locally with e.g. `openssl rand -hex 32`. **Never commit the value** — paste it into the Supabase dashboard or store it in GitHub Secrets only.

### 3. Configure the PostHog webhook destination

In PostHog → **Data pipeline** → **Destinations** → **New destination** → **Webhook**:

- **URL**: `https://<your-project-ref>.supabase.co/functions/v1/analytics-mirror`
- **HTTP method**: `POST`
- **Headers**:
  - `x-posthog-webhook-secret: <the same value you set above>`
  - `Content-Type: application/json`
- **Payload format**: PostHog default (single-event JSON or batched array under `batch`).
- **Filter**: leave at "all events", or restrict to the typed-union event names from `lib/analytics-events.ts`.

### 4. Verify

Trigger any tracked event in the app, then in the Supabase SQL editor (using the service-role key):

```sql
SELECT * FROM public.analytics_events ORDER BY occurred_at DESC LIMIT 5;
```

The function returns:
- `200 { inserted: N, errors: [] }` — every event inserted.
- `207 { inserted: N, errors: [...] }` — partial success (some malformed events skipped).
- `400` — invalid JSON / empty payload (no PostHog retry).
- `401` — secret mismatch.
- `500` — function not configured (missing env vars) or DB error.

## 20260517_items_cost_currency.sql

Run `supabase/migrations/20260517_items_cost_currency.sql` against your Supabase project to store the currency selected next to an item's cost in the create-item form:

```sql
-- Adds public.items.cost_currency (text, nullable).
-- Holds the ISO 4217 code (e.g. "USD", "EUR") chosen in the currency
-- selector. Nullable so legacy items / items without a cost stay NULL
-- and render unchanged.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS cost_currency text NULL;
```

Either apply it via the Supabase SQL editor, or push via the `supabase db push` workflow (the deploy workflow runs `supabase db push` automatically when `SUPABASE_DB_URL` is set, so a normal deploy applies this). The app keeps working either way: items always persist locally via AsyncStorage and the cloud upsert is best-effort (its failure is swallowed). Apply the migration so item cloud sync — which now sends `cost_currency` — keeps succeeding.

## delete-image Edge Function (SEC-1) — REQUIRED, security-critical

**Why:** the old client-side delete path read `EXPO_PUBLIC_CLOUDINARY_API_SECRET`,
which Metro inlines into the public JS bundle. The Cloudinary **account API
secret has therefore shipped in every deployed build and must be treated as
compromised.** Deletion now goes through the `delete-image` Edge Function,
which holds the secret server-side and verifies the caller's Supabase session.

### 1. Rotate the compromised Cloudinary secret (do this first)

In the Cloudinary console → **Settings → Security → Access Keys**: generate a
new API key/secret pair and **disable/delete the old one**. Until you do this,
the leaked secret in past bundles stays usable by anyone.

### 2. Remove the secret from the client build config

Delete these from **GitHub Secrets** and **EAS secrets** (they must never be
`EXPO_PUBLIC_*` again — that is what leaked them):

- `EXPO_PUBLIC_CLOUDINARY_API_SECRET`
- `EXPO_PUBLIC_CLOUDINARY_API_KEY`

(`EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME` / `_UPLOAD_PRESET` stay — they are public
by design.)

### 3. Deploy the function

```bash
supabase functions deploy delete-image --project-ref <your-project-ref>
```

### 4. Set the function secrets (server-side only)

```bash
supabase secrets set --project-ref <your-project-ref> \
  CLOUDINARY_CLOUD_NAME=<your cloud name> \
  CLOUDINARY_API_KEY=<the NEW api key from step 1> \
  CLOUDINARY_API_SECRET=<the NEW api secret from step 1>
# SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected by Supabase.
```

**Never commit these values** — set them only via the Supabase dashboard/CLI.

### 5. Verify

Trigger an account deletion (or any flow calling `deleteCloudinaryImages`)
while signed in; the asset disappears from Cloudinary and the function returns
`200 { success: true, deleted: N }`. An unauthenticated `POST` to
`/functions/v1/delete-image` must return `401`.

> Follow-up (tracked in `.tasks/.security-upgrade.md`): the function currently
> authorizes *any* valid session. Per-asset ownership (only delete assets the
> caller owns) requires a DB asset→owner mapping and is a separate hardening
> step; today's only caller deletes the signed-in user's own images during
> account deletion, so authenticated-session gating closes the secret-leak
> hole without it.


## 20260523_collection_currency.sql

Run `supabase/migrations/20260523_collection_currency.sql` against your Supabase project:

```sql
-- Adds public.collections.currency column (nullable text).
-- Carries the per-collection ISO 4217 currency override picked via the edit
-- modal or the tap-to-swap chip on the total-cost summary card. NULL means
-- 'fall back to the user's app-wide displayCurrency' — legacy rows keep
-- NULL and render unchanged.
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS currency text NULL;
```

Apply via the Supabase SQL editor or the `supabase db push` workflow.

## 20260528_profile_display_currency.sql

Run `supabase/migrations/20260528_profile_display_currency.sql` against your Supabase project:

```sql
-- Adds public.profiles.display_currency column (nullable text).
-- Syncs the user's app-wide display currency (ISO 4217) across devices.
-- NULL means 'fall back to the device-local preference, then the language
-- default' — existing rows keep NULL and behave exactly as before.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_currency text NULL;
```

Apply via the Supabase SQL editor or the `supabase db push` workflow.

## 20260527_marketplace_transfers.sql

Run `supabase/migrations/20260527_marketplace_transfers.sql` against your Supabase project to create the append-only sale audit log:

```sql
-- Creates public.marketplace_transfers(id, listing_id, item_id, owner_user_id,
-- buyer_user_id, mode, asking_price, currency, transferred_at).
--
-- listing_id is text-only (NOT a FK) so the audit row survives if the seller
-- deletes their marketplace_listings row later. owner_user_id / buyer_user_id
-- reference auth.users with ON DELETE SET NULL so account deletion scrubs PII
-- but leaves the financial record intact.
--
-- Unique index on listing_id enforces "one sale per listing" (idempotent on
-- retry). Per-party indexes on (buyer_user_id, transferred_at DESC) and
-- (owner_user_id, transferred_at DESC).
--
-- RLS:
--   * SELECT — restricted to the two parties (auth.uid() = buyer or owner).
--   * INSERT — buyer recording their own claim (auth.uid() = buyer_user_id).
--   * No UPDATE / DELETE policies — append-only by RLS. service_role bypasses.
```

Apply via the Supabase SQL editor or the `supabase db push` workflow.
