-- Add `buyer_user_id` column to marketplace_listings so a sold listing
-- records who bought it. Lays the foundation for marketplace-driven
-- item transfers (full trading cycle).
--
-- The column is nullable: legacy "mark sold" entries (seller-driven, no
-- recorded buyer) keep their NULL value, while new buyer-driven sales
-- carry the buyer's auth uid.

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS buyer_user_id uuid NULL
    REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS marketplace_listings_buyer_idx
  ON public.marketplace_listings (buyer_user_id);

-- Allow authenticated users to mark a listing they don't own as sold,
-- but only by setting `buyer_user_id` to themselves and `sold_at` to
-- a non-null timestamp. Sellers retain full update rights via the
-- existing `marketplace_listings_update_own` policy.
CREATE POLICY "marketplace_listings_update_buyer_claim"
ON public.marketplace_listings
FOR UPDATE
USING (auth.uid() IS NOT NULL AND sold_at IS NULL)
WITH CHECK (auth.uid() = buyer_user_id AND sold_at IS NOT NULL);
