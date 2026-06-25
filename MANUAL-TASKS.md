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

## 20260424_chat_messages.sql

Run `supabase/migrations/20260424_chat_messages.sql` against your Supabase project to give direct chats a server-of-truth store (until this lands, messages live only in each device's AsyncStorage and never reach the recipient):

```sql
-- Creates public.chat_messages(id, chat_id, from_user_id, to_user_id, text,
-- created_at) with RLS enabled:
--   * SELECT: either participant (auth.uid() = from_user_id OR to_user_id)
--   * INSERT: sender only (auth.uid() = from_user_id), recipient must be a
--     confirmed mutual friend (both directions of friend_requests exist)
--   * no UPDATE/DELETE policy → messages are immutable once stored
-- Indexes on (chat_id, created_at) and (to_user_id, created_at).
-- The table is added to the `supabase_realtime` publication so subscribed
-- clients receive new rows. Apply AFTER 20260423_base_schema.sql — the INSERT
-- policy references public.friend_requests.
```

Either apply it via the Supabase SQL editor, or push via the `supabase db push` workflow.

## 20260501_chat_reads.sql

Run `supabase/migrations/20260501_chat_reads.sql` against your Supabase project to sync the per-chat unread badge across devices:

```sql
-- Creates public.chat_reads(user_id, chat_id, last_read_at) with a composite
-- primary key (user_id, chat_id) and RLS enabled. Each user can only
-- SELECT/INSERT/UPDATE their own rows (auth.uid() = user_id). A missing row
-- means "never read" (unread count = all messages); markRead upserts the row.
```

Either apply it via the Supabase SQL editor, or push via the `supabase db push` workflow.

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


## claim-listing Edge Function (BE-20) — RECOMMENDED

**Why:** when a buyer claims a marketplace listing, doing it purely client-side
via the `marketplace_listings_update_buyer_claim` RLS policy is **not atomic**
— two buyers can both read `sold_at IS NULL` and both PATCH, so a listing can
be "sold" to two people. It also can't stop a seller from buying their own
listing. The `claim-listing` Edge Function runs the claim as a single
conditional UPDATE (`WHERE sold_at IS NULL AND owner_user_id <> caller`) under
the service-role key, so exactly one concurrent claim wins and a double-claim /
self-claim is rejected with `409`.

The app still works without it: an unconfigured/failed claim falls back to the
local optimistic update, and the legacy RLS PATCH path (`cloudMarkSold`) remains
for seller-driven "mark sold". Deploy the function to make buyer claims safe
against races.

### 1. Deploy the function

```bash
supabase functions deploy claim-listing --project-ref <your-project-ref>
```

### 2. Function secrets

```bash
supabase secrets set --project-ref <your-project-ref> \
  SUPABASE_SERVICE_ROLE_KEY=<your service_role / sb_secret_… key>
# SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected by Supabase.
```

**Never commit the service-role key.** The function self-checks the key at
invocation (BE-23) and returns `500 { error: "function misconfigured" }` if the
anon/publishable key was pasted by mistake.

### 3. Verify

Sign in as a buyer and claim an active listing — the function returns
`200 { success: true, listing }` and the row's `sold_at` / `buyer_user_id` are
set. Re-claiming the same listing (or claiming your own) returns `409`; an
unauthenticated `POST` to `/functions/v1/claim-listing` returns `401`.


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

## 20260616_core_tables_rls.sql

Run `supabase/migrations/20260616_core_tables_rls.sql` to enable Row Level
Security on the four core tables (`profiles`, `collections`, `items`,
`friend_requests`), which `20260423_base_schema.sql` intentionally left
unprotected. chat / marketplace / analytics tables already ship their own RLS
and are untouched.

```sql
-- Adds profiles.is_admin (boolean, default false) and REVOKEs UPDATE on that
-- column from the authenticated + anon roles so a crafted PATCH on a caller's
-- own profile row cannot self-promote to admin.
--
-- SECURITY DEFINER helpers (search_path pinned to public):
--   is_friend(a, b)              — both directed friend_requests rows exist.
--   is_visible_to(viewer, owner) — viewer = owner OR mutual friends.
--   can_view_collection(viewer, cid) — owner / public / shared_with / friend.
--   is_admin(uid)                — reads profiles.is_admin.
--
-- Policies (idempotent: DROP POLICY IF EXISTS before each CREATE):
--   profiles  — SELECT any authenticated user; INSERT/UPDATE own row only;
--               DELETE own row or any row when is_admin(auth.uid()).
--   collections — SELECT can_view_collection(); INSERT/UPDATE/DELETE owner only.
--   items     — SELECT follows parent collection visibility; INSERT/UPDATE/
--               DELETE require owning the parent collection.
--   friend_requests — SELECT/DELETE by either party; INSERT by sender only;
--               no UPDATE (rows immutable, unfriend = DELETE).
```

To grant yourself admin after applying, run once in the SQL editor (uses the
service_role / dashboard which bypasses the column REVOKE):

```sql
UPDATE public.profiles SET is_admin = true WHERE username = '1337antoxa';
```

Apply via the Supabase SQL editor or the `supabase db push` workflow.

### RLS leak check (BE-11a)

After applying, confirm an end-user role cannot escape its own data:

```sql
SET ROLE authenticated;
-- with no auth.uid() set, every gated table returns zero rows:
SELECT count(*) FROM public.collections;      -- expect 0 (no public + not owner)
SELECT count(*) FROM public.items;            -- expect 0
SELECT count(*) FROM public.friend_requests;  -- expect 0
RESET ROLE;
```

## 20260617_profiles_admin_update_grant.sql

SEC-ADMIN-1 — closes a privilege-escalation hole the column-level REVOKE in
`20260616_core_tables_rls.sql` did not actually close. In PostgreSQL a
*table-level* `UPDATE` grant covers every column and silently overrides a
column-level `REVOKE UPDATE (is_admin)`. Supabase's default bootstrap usually
runs `GRANT ALL … TO authenticated` (table-level), so the earlier REVOKE was a
no-op and any authenticated user could PATCH their own row to `is_admin = true`,
escalating to admin (then deleting any profile via `profiles_delete_own_or_admin`).

**Before applying**, confirm what `authenticated` actually holds on
`public.profiles` in the live project:

```sql
-- table-level vs column-level UPDATE grants held by the end-user roles:
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND grantee IN ('authenticated', 'anon');

SELECT grantee, column_name, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND grantee IN ('authenticated', 'anon');
```

If `authenticated` has a table-level `UPDATE` row above, the hole is open. Apply
the migration to drop table-level UPDATE and re-grant per-column excluding
`is_admin`:

```sql
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;
GRANT UPDATE (id, email, display_name, username, public_id, bio, avatar,
  display_currency, created_at) ON public.profiles TO authenticated;
```

After applying, verify self-promotion is denied (run as a normal user, NOT the
dashboard/service_role which bypasses grants):

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"<your-auth-uid>","role":"authenticated"}', true);
UPDATE public.profiles SET is_admin = true WHERE id = '<your-auth-uid>';
-- expect: ERROR  permission denied for table profiles  (SQLSTATE 42501)
RESET ROLE;
```

`is_admin` stays a service-role-only column: grant admin via the SQL editor
snippet under `20260616_core_tables_rls.sql`. If this column list ever drifts
from the `profiles` schema, update both this snippet and the migration.

## 20260618_fk_on_delete_cascade.sql

BE-6 — guarantees every cross-table foreign key carries an explicit
`ON DELETE CASCADE`. The base schema already defines these FKs with CASCADE,
but the live project's tables were created by hand in the dashboard, where the
FKs may have been added with the PostgreSQL default `NO ACTION`. A `NO ACTION`
FK makes the `delete-account` Edge Function fail with a `23503`
foreign_key_violation (the account can't be deleted) and blocks deleting a
collection that still has items.

**Before applying**, check the current delete action of the six core FKs:

```sql
SELECT con.conrelid::regclass AS tbl, con.conname, con.confdeltype
FROM pg_constraint con
WHERE con.contype = 'f'
  AND con.conrelid IN (
    'public.profiles'::regclass, 'public.collections'::regclass,
    'public.items'::regclass, 'public.friend_requests'::regclass);
-- confdeltype: 'c' = CASCADE (desired), 'a' = NO ACTION, 'r' = RESTRICT.
```

If any of the FKs below show `confdeltype <> 'c'`, apply the migration. It drops
each existing single-column FK (whatever its name) and re-adds a canonically
named one with `ON DELETE CASCADE`:

| table | column | references | on delete |
| --- | --- | --- | --- |
| profiles | id | auth.users(id) | CASCADE |
| collections | owner_user_id | auth.users(id) | CASCADE |
| items | collection_id | public.collections(id) | CASCADE |
| items | created_by_user_id | auth.users(id) | CASCADE |
| friend_requests | from_user_id | auth.users(id) | CASCADE |
| friend_requests | to_user_id | auth.users(id) | CASCADE |

The migration is idempotent (drop-then-add of the same CASCADE constraint), so
re-applying it is a safe no-op. After applying, re-run the `confdeltype` query
above and confirm every row reads `c`. The `02_fk_cascade.sql` pgTAP test
exercises the full delete-account cascade on the from-empty CI database.

## 20260619_integrity_checks.sql

BE-7 — backfills the data-integrity CHECK constraints + the friend-request
uniqueness onto the existing (hand-created) live tables. The base schema defines
them inline, but `CREATE TABLE IF NOT EXISTS` can't add a missing CHECK/UNIQUE
to a table that already exists (same gap class as BE-6's FKs).

Constraints ensured (each guarded, so a re-run is a no-op):

| table | constraint | rule |
| --- | --- | --- |
| collections | `collections_visibility_check` | `visibility IN ('public','private')` |
| items | `items_condition_check` | `condition IN ('new','excellent','good','fair')` |
| friend_requests | `friend_requests_no_self` | `from_user_id <> to_user_id` |
| friend_requests | `friend_requests_pair_key` (unique idx) | directed `(from_user_id, to_user_id)` pair |

**Before applying**, check whether the live table already enforces them:

```sql
SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid IN ('public.collections'::regclass, 'public.items'::regclass,
                   'public.friend_requests'::regclass)
  AND contype = 'c';
```

Adding a CHECK validates existing rows, so if a row violates it the `ALTER`
fails — fix the offending data first (visibility/condition are app-controlled,
so this is unlikely). Two parts of the original BE-7 note are intentionally
**not** implemented: `collections.role` is not a DB column (it's derived
client-side), and an *undirected* `least/greatest(from,to)` unique would break
the mutual-friendship model (both directed rows must coexist) — the directed
pair unique is the correct key.

## 20260620_fk_index_coverage.sql

BE-8 — index coverage for every foreign key + hot read paths. Adds the single
missing FK-backing index: `chat_messages.from_user_id` (its FK to
`auth.users` had no leading-column index, so deleting a user seq-scanned
chat_messages to cascade the sender's rows). Every other FK and every hot read
path named in BE-8 — `items(collection_id)`, `collections(owner_user_id)`,
`friend_requests(to_user_id)`, `profiles(public_id)`, `profiles(username)` —
already has a leading-column index from an earlier migration.

Idempotent (`CREATE INDEX IF NOT EXISTS`), so applying on an up-to-date project
is a no-op. **Before applying** (optional) confirm which FKs lack a covering
index on the live project:

```sql
SELECT c.conrelid::regclass AS tbl, a.attname AS fk_column
FROM pg_constraint c
JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND (i.indkey::int2[])[0] = a.attnum
  );
```

There is no `friend_requests.status` column (the app uses the directed-pair
model), so the BE-8 `(to_user_id, status)` composite is intentionally not added.

## 20260621_updated_at_moddatetime.sql

BE-9 — uniform `updated_at` + `moddatetime` auto-bump trigger on every table,
the per-row cursor that delta pulls (BE-14, `updated_at=gt.<cursor>`) need.

Adds `updated_at timestamptz NOT NULL DEFAULT now()` to all nine tables
(`profiles`, `collections`, `items`, `friend_requests`, `chat_messages`,
`chat_reads`, `marketplace_listings`, `marketplace_transfers`,
`analytics_events`) and a `BEFORE UPDATE` trigger `handle_updated_at` calling
`extensions.moddatetime(updated_at)`. The trigger fires on every UPDATE,
including the DO-UPDATE branch of the app's PostgREST upserts, so synced rows
get a fresh cursor automatically without the client sending `updated_at`.

`created_at` is **not** added to the three append-only audit/log tables — each
already has an equivalent NOT NULL `... DEFAULT now()` creation timestamp
(`analytics_events.occurred_at`, `marketplace_transfers.transferred_at`,
`chat_reads.last_read_at`); the six core tables already have `created_at`.

Idempotent (`ADD COLUMN IF NOT EXISTS` + `DROP TRIGGER IF EXISTS` before
`CREATE TRIGGER`), so applying on an up-to-date project is a no-op. Requires the
contrib `moddatetime` extension; the migration installs it into the
`extensions` schema (`CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA
extensions`).

## 20260622_not_null_defaults.sql

BE-10 — backfill `NOT NULL` + defaults on the columns the client always sends a
concrete value for. `20260423_base_schema.sql` already DECLARES these columns as
`NOT NULL DEFAULT <…>`, but the live tables were hand-created in the dashboard
where a column may have been left nullable / without a default, and
`CREATE TABLE IF NOT EXISTS` can't repair an existing column (same gap class as
BE-6/BE-7/BE-8).

Repairs each column in three idempotent steps — backfill any existing NULLs to
the default, `SET DEFAULT`, then `SET NOT NULL`:

- `profiles`: `email`, `display_name`, `username`, `public_id`, `bio`, `avatar`
  → `''`
- `collections`: `name`, `cover_photo`, `description`, `owner_name` → `''`;
  `visibility` → `'private'`; `shared_with_user_ids` → `'{}'::uuid[]`;
  `created_at` → `now()`
- `items`: `title`, `acquired_at`, `acquired_from`, `description`, `variants`,
  `created_by` → `''`; `photos` → `'{}'::text[]`; `is_wishlist` → `false`;
  `created_at` → `now()`

The uuid FK columns (`collections.owner_user_id`, `items.created_by_user_id`)
are **not** touched — they have no sensible scalar default and their NOT
NULL/FK integrity is owned by base_schema + BE-6
(`20260618_fk_on_delete_cascade.sql`).

Pairs with the app-side `coerce*` read-path validators
(`lib/supabase-row-coerce.ts`): the DB guarantees the value, the validators are
the belt-and-suspenders for any row predating this migration or fetched from a
project where it hasn't been applied.

Idempotent: applying on a base_schema/branch-preview DB where the columns are
already `NOT NULL DEFAULT` is a no-op (the backfill matches zero rows; the
ALTERs restate the existing shape). No pre-apply check required.

## 20260623_soft_delete_deleted_at.sql

BE-15a — soft-delete foundation for the LWW/tombstone conflict policy (see
[`docs/CONFLICT-POLICY.md`](./docs/CONFLICT-POLICY.md)). A hard `DELETE` is
invisible to the `updated_at=gt.<cursor>` delta pull (BE-14), so a peer that
hasn't synced since can never learn a row was removed and its seed/cached copy
resurrects. The fix is a soft delete: set `deleted_at` instead of removing the
row — the BE-9 moddatetime trigger bumps `updated_at` on that same UPDATE, so
the tombstone rides the normal delta pull to every peer.

Adds a nullable `deleted_at timestamptz` (NULL = alive, non-null = the time it
was tombstoned — no default) + a partial `<table>_alive_idx (deleted_at)
WHERE deleted_at IS NULL` index to the four user-deletable tables:

- `collections`, `items`, `profiles`, `friend_requests`

The append-only audit/log tables (`analytics_events`, `marketplace_transfers`,
`chat_reads`) are never user-deleted, so they get no column.

Pairs with the app-side `lib/tombstones.ts` helper (generalising the social
graph's `deletedProfileIds` set): a delta batch is split into still-alive rows
vs tombstoned ids, which are dropped from the local cache and accumulated into a
persisted per-entity tombstone set so a later full/seed load can't resurrect a
remotely deleted entity.

Idempotent: `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`, so a
re-run (or applying on top of the live schema) is a no-op. No pre-apply check
required. A future retention sweep (BE-27) can hard-purge rows whose
`deleted_at` is older than the retention window.


## 20260624_accept_friend_request.sql

BE-21 — the transactional core of the `accept-friend-request` Edge Function
(see its section below). A friendship is mutual: it exists only when **both**
directed `friend_requests` rows are present (sender→acceptor AND
acceptor→sender). Accepting an incoming request is therefore inserting the
reverse direction — but a naive client-side `INSERT` never checks that the
inbound request still exists, so a concurrently-withdrawn request leaves a
dangling one-way row that looks like a brand-new *outgoing* request.

This migration adds the `accept_friend_request(p_from_user_id, p_to_user_id)`
SQL function (`SECURITY DEFINER`, `search_path = public`). It locks the inbound
sender→acceptor row `FOR UPDATE` (so a concurrent withdrawal blocks until the
accept commits), raises `P0002` ("no pending friend request") if it is gone,
then inserts the reverse direction idempotently — so both directions become
present, or neither does, atomically. It returns the resulting directed rows.

It is granted **only to `service_role`** (`REVOKE ALL … FROM PUBLIC` +
`GRANT EXECUTE … TO service_role`): it trusts its `p_to_user_id` argument, so it
must never be reachable by an anon/authenticated PostgREST session that could
pass any id. The `accept-friend-request` Edge Function validates the caller via
`auth.getUser()` and is the only intended caller.

Run `supabase/migrations/20260624_accept_friend_request.sql` against your
project. Idempotent: `CREATE OR REPLACE FUNCTION` + idempotent GRANT/REVOKE, so
re-running is a no-op. No pre-apply check required.


## 20260625_subscriptions.sql

BE-22a — the server-authoritative source of truth for premium entitlement.
Until now "premium" lived purely in AsyncStorage, so any client could grant
itself paid features by writing the local flag. This migration adds a
`subscriptions` table (one row per user) that the `validate-premium` Edge
Function (BE-22b) writes under the service-role key — never an end-user session.

Columns: `user_id` (PK + FK→`auth.users` `ON DELETE CASCADE`, so a deleted
account's entitlement vanishes with it), `status`
(`active`/`inactive`/`expired`/`cancelled`, CHECK-constrained), `activated_at`,
`current_period_end` (NULL = no known expiry), `created_at`/`updated_at` (the
BE-9 moddatetime trigger auto-bumps `updated_at` so delta pulls carry the
change), and a `deleted_at` soft-delete tombstone (BE-15) with a partial
`subscriptions_alive_idx`.

RLS is enabled with a single **SELECT-own** policy (`auth.uid() = user_id`) so a
user can read their own cached entitlement, and **no INSERT/UPDATE/DELETE
policy** — writes are service_role-only (which bypasses RLS), so a crafted
client can never mint or extend its own subscription via PostgREST.

Run `supabase/migrations/20260625_subscriptions.sql` against your project.
Idempotent: `CREATE TABLE/INDEX … IF NOT EXISTS` + `DROP TRIGGER/POLICY IF
EXISTS` before each `CREATE`, so re-running is a no-op. No pre-apply check
required. The `validate-premium` Edge Function (BE-22b, below) is the only
writer of this table.


## validate-premium Edge Function (BE-22b) — RECOMMENDED

**Why:** premium entitlement used to live purely in AsyncStorage, so any client
could grant itself paid features by writing the local flag. The `subscriptions`
table (migration above) is the server-authoritative source of truth, but RLS
grants the end-user only SELECT on their own row — all writes are
service_role-only. The `validate-premium` Edge Function is that writer: it
validates the caller via `auth.getUser()`, reads their `subscriptions` row under
the service-role key, lazily expires a lapsed `current_period_end`, and returns
the server-validated `{ isPremium, activatedAt, expiresAt }` entitlement.
BE-22c LWW-merges that server truth over the local cache so paid features gate
on the server row, not local storage.

The app still works without it: `cloudValidatePremium()` returns `null` when the
function is unconfigured/unreachable, and the premium context keeps its local
cache. Deploy the function (and apply the migration above) to make premium
server-authoritative.

### 1. Apply the migration

Apply `supabase/migrations/20260625_subscriptions.sql` (see its section above) —
the function reads and writes that table.

### 2. Deploy the function

```bash
supabase functions deploy validate-premium --project-ref <your-project-ref>
```

### 3. Function secrets

```bash
supabase secrets set --project-ref <your-project-ref> \
  SUPABASE_SERVICE_ROLE_KEY=<your service_role / sb_secret_… key>
# SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected by Supabase.
```

**Never commit the service-role key.** The function self-checks the key at
invocation (BE-23) and returns `500 { error: "function misconfigured" }` if the
anon/publishable key was pasted by mistake.

### 4. Verify

Sign in and `POST` `{ "action": "activate" }` to
`/functions/v1/validate-premium` with the user token — it returns
`200 { isPremium: true, activatedAt, expiresAt }` and a `subscriptions` row is
written with `status='active'`. A subsequent `{ "action": "validate" }` (or an
empty body) returns the same entitlement; once `current_period_end` has passed
it flips the row to `status='expired'` and returns `isPremium: false`. An
unauthenticated `POST` returns `401`; an unknown `action` returns `400`.


## export-data Edge Function (BE-26) — RECOMMENDED

**Why:** GDPR Art. 20 (right to data portability) requires giving a user a
machine-readable copy of everything we store about them. The `export-data` Edge
Function assembles that bundle — the caller's `profiles` row, the `collections`
they own, the `items` they authored, their `friend_requests` (both directions),
their `chat_messages` (sent + received), and their `subscriptions` history —
into a single downloadable JSON document (`Content-Disposition: attachment`).

The caller is validated via `auth.getUser()` and the export is always scoped to
that authenticated user (never a body-supplied id). Reads run under the
service-role key so the export sees every row regardless of the end-user's RLS
read scope, while still being filtered to the caller. The client wrapper
`cloudExportData()` (`lib/supabase-data-export.ts`) returns the document or
`null` when the function is unconfigured/unreachable.

No migration — the function reads the existing core tables. There is nothing to
apply; just deploy the function and set its secret.

### 1. Deploy the function

```bash
supabase functions deploy export-data --project-ref <your-project-ref>
```

### 2. Function secrets

```bash
supabase secrets set --project-ref <your-project-ref> \
  SUPABASE_SERVICE_ROLE_KEY=<your service_role / sb_secret_… key>
# SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected by Supabase.
```

**Never commit the service-role key.** The function self-checks the key at
invocation (BE-23) and returns `500 { error: "function misconfigured" }` if the
anon/publishable key was pasted by mistake.

### 3. Verify

Sign in and `POST` an empty body to `/functions/v1/export-data` with the user
token — it returns `200` with a JSON document `{ version, exportedAt, userId,
profile, collections, items, friendRequests, chatMessages, subscriptions }` and
a `Content-Disposition: attachment` header. An unauthenticated `POST` returns
`401`; a non-`POST` returns `405`.


## accept-friend-request Edge Function (BE-21) — RECOMMENDED

**Why:** accepting a friend request client-side (a plain `INSERT` of the
acceptor→sender row) is not transactional — it never verifies the inbound
request still exists, so if the sender withdraws it concurrently the acceptor is
left with a dangling one-way row that reads as a *new* outgoing request. The
`accept-friend-request` Edge Function runs the flip through the
`accept_friend_request` SQL function (above) under the service-role key: it
locks the inbound row, rejects with `409` if it is gone, and inserts the reverse
direction idempotently — both directions flip to "friends" or neither does.

The app still works without it: an unconfigured/failed accept falls back to the
local optimistic update and the pending-social queue re-delivers it. Deploy the
function (and apply the migration above) to make accepts race-safe.

### 1. Apply the SQL function

Apply `supabase/migrations/20260624_accept_friend_request.sql` (see its section
above) — the function depends on it.

### 2. Deploy the function

```bash
supabase functions deploy accept-friend-request --project-ref <your-project-ref>
```

### 3. Function secrets

```bash
supabase secrets set --project-ref <your-project-ref> \
  SUPABASE_SERVICE_ROLE_KEY=<your service_role / sb_secret_… key>
# SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected by Supabase.
```

**Never commit the service-role key.** The function self-checks the key at
invocation (BE-23) and returns `500 { error: "function misconfigured" }` if the
anon/publishable key was pasted by mistake.

### 4. Verify

Have user B accept a pending request from user A — the function returns
`200 { success: true, friendRequests: [...] }` and both directed rows now exist
(`is_friend(A, B)` is true). Accepting a request that was withdrawn returns
`409`; an unauthenticated `POST` to `/functions/v1/accept-friend-request`
returns `401`; accepting "yourself" returns `400`.

## 20260626_realtime_replica_identity.sql

BE-19 extends realtime to UPDATE/DELETE for collections, items and
marketplace_listings (cross-device edits and removals now propagate without a
manual refresh). Two server-side prerequisites are set by this migration:

1. **Publication membership** — the three tables are added to the
   `supabase_realtime` publication (only `chat_messages` was added explicitly
   before; the rest were assumed enabled via the dashboard). Guarded by a
   membership check so re-applying is a no-op.

2. **`REPLICA IDENTITY FULL`** — a DELETE event (and a server-side-filtered
   UPDATE) only carries the columns in the table's replica identity. The default
   is the primary key, so a DELETE would expose only `id` and a filter like
   `owner_user_id=eq.<uid>` could never match the old row — the event would be
   dropped. `REPLICA IDENTITY FULL` records the full pre-image so filtered
   DELETEs are delivered and consumers get a usable row.

The migration is idempotent. If you applied it via `supabase db push` or the SQL
editor, no further action is needed. If you previously enabled realtime for
these tables only via the **Dashboard → Database → Replication** toggle, this
migration is still safe to run — the publication ADD is skipped when the table
is already a member, and it adds the `REPLICA IDENTITY FULL` the toggle does not
set.

## 20260627_retention_sweeps.sql

BE-27 adds `pg_cron` retention sweeps so three classes of data don't grow
forever. It ships a `service_role`-only `public.run_retention_sweeps()` function
and schedules it daily at 03:00 UTC.

**Retention windows** (keep in sync with the privacy policy paragraph in
`APPSTORE-SUBMISSION.md` → "Server-side data retention"):

1. **analytics_events — 13 months.** The server-side PostHog mirror keeps ~13
   months for Power BI / SQL year-over-year reporting, then the long tail is
   dropped.
2. **abandoned anonymous analytics — 30 days.** `analytics_events` rows with
   `user_id IS NULL` (PostHog anonymous distinct_ids that never resolved to an
   account) carry no per-account value, so they get the most aggressive window.
3. **soft-delete tombstones — 90 days.** `collections` / `items` / `profiles` /
   `friend_requests` rows with a non-NULL `deleted_at` (20260623) are
   hard-deleted once the 90-day grace passes — long enough for every offline
   peer to delta-pull the deletion under the LWW conflict policy.

**One-time prerequisite — enable pg_cron.** `pg_cron` is not enabled by default.
In the Supabase dashboard go to **Database → Extensions**, search `pg_cron`, and
enable it (or run `CREATE EXTENSION pg_cron;` in the SQL editor). The migration's
scheduling block is guarded: if `pg_cron` is absent it is a no-op (the function
and grants still apply), so **after enabling pg_cron, re-run this migration** to
create the `retention-sweeps` cron job. Verify with:

```sql
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'retention-sweeps';
```

To run a sweep on demand (e.g. before verifying the windows):

```sql
SELECT public.run_retention_sweeps();
```

The migration is otherwise idempotent — `CREATE OR REPLACE FUNCTION`, idempotent
GRANT/REVOKE, and the cron job is unscheduled-before-scheduled so re-applying
never stacks duplicate jobs.

## 20260628_marketplace_arrived_at.sql

Run `supabase/migrations/20260628_marketplace_arrived_at.sql` against your
Supabase project to add the missing `arrived_at` column to
`marketplace_listings`:

```sql
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz NULL;
```

**Why it matters.** The client already requests `arrived_at` in its `select=`
projection (`MARKETPLACE_COLUMNS` in `lib/supabase-marketplace-shapes.ts`) and
`rowToListing` reads it, but no earlier migration created the column. Against a
real project the listings fetch (`fetchListingsUrl` / `fetchListingByIdUrl`)
returns `400 — column marketplace_listings.arrived_at does not exist`, which
breaks the entire marketplace read path. Apply this migration before relying on
cloud marketplace reads.

Idempotent (`ADD COLUMN IF NOT EXISTS`) — safe to re-run. Apply via the Supabase
SQL editor or the `supabase db push` workflow.
