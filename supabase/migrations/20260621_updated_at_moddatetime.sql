-- BE-9 — uniform `updated_at` + auto-bump trigger on every table.
--
-- Delta pulls (BE-14) want a single per-row cursor column they can filter on
-- (`updated_at=gt.<lastSyncedAt>`). This migration gives every table an
-- `updated_at timestamptz NOT NULL DEFAULT now()` and a `BEFORE UPDATE` trigger
-- that bumps it on every mutation (including the DO-UPDATE branch of the app's
-- PostgREST upserts), using the contrib `moddatetime` function.
--
-- `created_at` already exists on the six core/mutable tables
-- (profiles/collections/items/friend_requests/chat_messages/marketplace_listings).
-- The three append-only audit/log tables each already carry a semantically
-- equivalent NOT NULL `... DEFAULT now()` creation timestamp
-- (analytics_events.occurred_at, marketplace_transfers.transferred_at,
-- chat_reads.last_read_at), so no redundant `created_at` is added there — but
-- they still get `updated_at` so the delta-pull cursor is uniform across the
-- whole schema. On the append-only tables the trigger simply never fires.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` + `DROP TRIGGER IF EXISTS` before
-- each `CREATE TRIGGER`, so re-applying (or applying on top of the live schema)
-- is a no-op. `moddatetime` is installed into the `extensions` schema (Supabase
-- convention) and referenced fully-qualified so it resolves regardless of the
-- session search_path.

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles',
    'collections',
    'items',
    'friend_requests',
    'chat_messages',
    'chat_reads',
    'marketplace_listings',
    'marketplace_transfers',
    'analytics_events'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()',
      t
    );
    EXECUTE format('DROP TRIGGER IF EXISTS handle_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at)',
      t
    );
  END LOOP;
END $$;
