-- BE-15a — soft-delete (`deleted_at`) foundation for the conflict policy.
--
-- The sync conflict policy is Last-Write-Wins by `updated_at` (BE-9 gave every
-- table a `updated_at` + moddatetime auto-bump trigger; BE-14 delta-pulls on
-- `updated_at=gt.<cursor>`). A hard `DELETE` is invisible to a delta pull — the
-- row just disappears, so a peer that hasn't synced since can never learn it
-- was removed and its seed/cached copy resurrects. The fix, generalising the
-- social-graph "deleted profile IDs" tombstone set, is a soft delete: set a
-- `deleted_at` timestamp instead of removing the row. The BE-9 `BEFORE UPDATE`
-- moddatetime trigger bumps `updated_at` on that same UPDATE, so the tombstone
-- rides the normal delta pull to every peer, which then drops it locally.
--
-- This migration only adds the column + a partial "alive" index to the four
-- user-deletable tables (collections, items, profiles, friend_requests). The
-- append-only audit/log tables are never user-deleted, so they get no column.
--
-- `deleted_at` is nullable with NO default: NULL = alive, non-NULL = tombstoned
-- (the timestamp it was deleted). The partial index `WHERE deleted_at IS NULL`
-- keeps the hot "alive rows" read paths cheap as tombstones accumulate, and is
-- the index a future retention sweep (BE-27) scans the inverse of.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`, so
-- re-applying (or applying on top of the live schema) is a no-op.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'collections',
    'items',
    'profiles',
    'friend_requests'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_at timestamptz',
      t
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (deleted_at) WHERE deleted_at IS NULL',
      t || '_alive_idx',
      t
    );
  END LOOP;
END $$;
