-- marketplace_listings.buyer_user_id: who acquired the item when sold/traded.
--
-- Foundation for the full trading cycle. When the seller (or buyer in a future
-- buyer-driven flow) marks a listing as sold, we now record which user
-- received the item so a "Trades & Transfers" history can be reconstructed
-- from sold listings. Nullable because legacy sold listings never recorded a
-- buyer.

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS buyer_user_id uuid NULL
    REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS marketplace_listings_buyer_idx
  ON public.marketplace_listings (buyer_user_id, sold_at DESC)
  WHERE buyer_user_id IS NOT NULL;
