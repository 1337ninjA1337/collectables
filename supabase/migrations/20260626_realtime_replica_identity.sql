-- BE-19 — make UPDATE/DELETE realtime events deliverable for collections,
-- items and marketplace_listings.
--
-- BE-18 wired INSERT-only postgres-changes for the user's own collections/items;
-- the marketplace channel already listened to INSERT + UPDATE for listings.
-- BE-19 extends the client to ALSO listen for UPDATE and DELETE so cross-device
-- edits and removals propagate without a manual refresh. Two server-side
-- prerequisites must hold for those events to actually reach the client:
--
-- 1. PUBLICATION MEMBERSHIP. Only `chat_messages` was explicitly added to the
--    `supabase_realtime` publication in a migration (20260424); the other tables
--    were assumed enabled via the dashboard. We add them here, guarded by a
--    membership check so re-applying (or applying on top of a dashboard-enabled
--    project) is a no-op.
--
-- 2. REPLICA IDENTITY. A DELETE event — and a server-side-filtered UPDATE —
--    only carries the columns in the table's REPLICA IDENTITY. The Postgres
--    default is the PRIMARY KEY, so a DELETE payload would expose only `id`, and
--    a filter such as `owner_user_id=eq.<uid>` could never match the old row, so
--    the event would be dropped before it left the server. `REPLICA IDENTITY
--    FULL` records the entire pre-image, so filtered DELETEs are delivered and
--    consumers receive a usable row. The extra WAL volume is acceptable for
--    these low-write user tables.
--
-- Idempotent: `ALTER TABLE ... REPLICA IDENTITY FULL` is naturally repeatable,
-- and the publication ADD is wrapped in an existence check.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'collections',
    'items',
    'marketplace_listings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        t
      );
    END IF;
  END LOOP;
END $$;
