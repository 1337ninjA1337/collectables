# Manual Tasks

These DB changes must be applied manually to the Supabase project (or will be auto-applied via the `supabase db push` CI step if `SUPABASE_DB_URL` secret is set).

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

### Verify the RLS lock-down (Analytics #16)

After applying the migration, run this in the **Supabase SQL editor** to
confirm that anonymous + authenticated callers cannot read event history and
that only the `service_role` (the role Power BI authenticates as) can. The
SQL editor connects as the table owner, so we `SET ROLE` to impersonate each
end-user role:

```sql
-- 1. anon (logged-out) must NOT be able to read events:
SET ROLE anon;
SELECT count(*) FROM public.analytics_events;   -- EXPECT: ERROR permission denied for table analytics_events
RESET ROLE;

-- 2. authenticated (logged-in end user) must NOT be able to read events:
SET ROLE authenticated;
SELECT count(*) FROM public.analytics_events;   -- EXPECT: ERROR permission denied for table analytics_events
RESET ROLE;

-- 3. service_role (Power BI / analytics-mirror) MUST be able to read events:
SET ROLE service_role;
SELECT count(*) FROM public.analytics_events;   -- EXPECT: a row count, no error
RESET ROLE;
```

Checklist — the migration is correctly locked down iff **all** of:

- [ ] Step 1 errors with `permission denied for table analytics_events`.
- [ ] Step 2 errors with `permission denied for table analytics_events`.
- [ ] Step 3 returns a count with no error.

If step 1 or 2 returns a number instead of erroring, a permissive `GRANT`
or `CREATE POLICY` has leaked onto `public.analytics_events` (a regression of
the Analytics #12 default-deny posture) and the full event history is exposed
to end users — revoke it immediately:

```sql
REVOKE ALL ON public.analytics_events FROM anon, authenticated;
-- and drop any policy that referenced the table:
-- DROP POLICY <name> ON public.analytics_events;
```

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

## 20260516_items_cost_currency.sql

Run `supabase/migrations/20260516_items_cost_currency.sql` against your Supabase project to store the currency selected next to an item's cost in the create-item form:

```sql
-- Adds public.items.cost_currency (text, nullable).
-- Holds the ISO 4217 code (e.g. "USD", "EUR") chosen in the currency
-- selector. Nullable so legacy items / items without a cost stay NULL
-- and render unchanged.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS cost_currency text NULL;
```

Either apply it via the Supabase SQL editor, or push via the `supabase db push` workflow (the deploy workflow runs `supabase db push` automatically when `SUPABASE_DB_URL` is set, so a normal deploy applies this). The app keeps working either way: items always persist locally via AsyncStorage and the cloud upsert is best-effort (its failure is swallowed). Apply the migration so item cloud sync — which now sends `cost_currency` — keeps succeeding.
