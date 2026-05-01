-- marketplace_listings: server-of-truth storage for marketplace listings.
--
-- Previously listings were stored only in AsyncStorage on the originating
-- device, making them invisible to other users. This migration introduces a
-- Postgres-backed table with row-level security so:
--   * any authenticated user can SELECT active listings (sold_at IS NULL)
--   * a user may only INSERT rows where owner_user_id is themselves
--   * a user may only DELETE or UPDATE rows they own
--
-- The app uses this table as the primary store and falls back to AsyncStorage
-- when Supabase is not configured (e.g. during offline use or development).

CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id              text          PRIMARY KEY,
  item_id         text          NOT NULL,
  owner_user_id   uuid          NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  mode            text          NOT NULL CHECK (mode IN ('sell', 'trade')),
  asking_price    numeric       NULL,
  currency        text          NOT NULL DEFAULT 'USD',
  notes           text          NOT NULL DEFAULT '',
  created_at      timestamptz   NOT NULL DEFAULT now(),
  sold_at         timestamptz   NULL
);

CREATE INDEX IF NOT EXISTS marketplace_listings_owner_idx
  ON public.marketplace_listings (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_listings_item_idx
  ON public.marketplace_listings (item_id);

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all listings (marketplace is public).
CREATE POLICY "marketplace_listings_select_authenticated"
ON public.marketplace_listings
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Users can only insert their own listings.
CREATE POLICY "marketplace_listings_insert_own"
ON public.marketplace_listings
FOR INSERT
WITH CHECK (auth.uid() = owner_user_id);

-- Users can only update (e.g. mark sold) their own listings.
CREATE POLICY "marketplace_listings_update_own"
ON public.marketplace_listings
FOR UPDATE
USING (auth.uid() = owner_user_id);

-- Users can only delete their own listings.
CREATE POLICY "marketplace_listings_delete_own"
ON public.marketplace_listings
FOR DELETE
USING (auth.uid() = owner_user_id);
