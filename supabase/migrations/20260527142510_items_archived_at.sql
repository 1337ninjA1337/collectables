-- Add `archived_at` to items so the seller can soft-archive an item after a
-- marketplace sale without losing it from storage. Archived items stay in
-- the database for stats and audit history but are filtered out of the
-- collection listings, totals, recent items and search surfaces. Nullable:
-- legacy and live items keep NULL and render exactly as before.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
