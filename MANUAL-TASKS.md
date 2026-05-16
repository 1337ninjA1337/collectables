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
