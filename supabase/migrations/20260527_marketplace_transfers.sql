-- marketplace_transfers: append-only audit log of completed marketplace sales.
--
-- Today the buyer/seller pair, sale price, and timestamp live inside the
-- `marketplace_listings` row that was claimed. That row stays alive after a
-- sale, but `ON DELETE CASCADE` on `owner_user_id` means a seller deleting
-- their auth account also wipes the listing — and with it the price/mode
-- context the buyer's "Acquired via marketplace" history relied on. Even
-- without account deletion, a seller can manually delete the listing via the
-- existing UPDATE/DELETE RLS policies and lose the same context.
--
-- This table snapshots the sale fields at transfer time so the audit trail
-- survives:
--   * `marketplace_listings` may be deleted independently — `listing_id` is
--     just a text reference, not a FK, so we never lose history.
--   * `owner_user_id` / `buyer_user_id` reference `auth.users` with
--     `ON DELETE SET NULL` so a deleted account scrubs PII but leaves the
--     financial record intact.
--
-- Writes are restricted to authenticated buyers recording their own purchase
-- (with `buyer_user_id = auth.uid()`); rows are otherwise append-only. Read
-- access is limited to the two parties involved, mirroring how the listing
-- itself only exposes the seller's `owner_user_id` to the buyer.

CREATE TABLE IF NOT EXISTS public.marketplace_transfers (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      text          NOT NULL,
  item_id         text          NOT NULL,
  owner_user_id   uuid          NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  buyer_user_id   uuid          NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  mode            text          NOT NULL CHECK (mode IN ('sell', 'trade')),
  asking_price    numeric       NULL,
  currency        text          NOT NULL DEFAULT 'USD',
  transferred_at  timestamptz   NOT NULL DEFAULT now()
);

-- One sale per listing — a buyer claiming the same listing twice (cross-device
-- race, retry after network failure) must collapse to a single audit row.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_transfers_listing_uniq
  ON public.marketplace_transfers (listing_id);

CREATE INDEX IF NOT EXISTS marketplace_transfers_buyer_idx
  ON public.marketplace_transfers (buyer_user_id, transferred_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_transfers_owner_idx
  ON public.marketplace_transfers (owner_user_id, transferred_at DESC);

ALTER TABLE public.marketplace_transfers ENABLE ROW LEVEL SECURITY;

-- Read: only the two parties involved.
-- DROP-then-CREATE so re-runs against branch-preview DBs (where the policy
-- survives from a prior apply) don't error with SQLSTATE 42710.
-- PostgreSQL ≤16 has no `CREATE POLICY IF NOT EXISTS`.
DROP POLICY IF EXISTS "marketplace_transfers_select_party" ON public.marketplace_transfers;
CREATE POLICY "marketplace_transfers_select_party"
ON public.marketplace_transfers
FOR SELECT
USING (auth.uid() = buyer_user_id OR auth.uid() = owner_user_id);

-- Insert: the buyer recording their own claim.
DROP POLICY IF EXISTS "marketplace_transfers_insert_buyer" ON public.marketplace_transfers;
CREATE POLICY "marketplace_transfers_insert_buyer"
ON public.marketplace_transfers
FOR INSERT
WITH CHECK (auth.uid() = buyer_user_id);

-- No UPDATE / DELETE policies — the table is append-only by RLS. Service
-- role (e.g. a future admin-driven correction) can still bypass.
