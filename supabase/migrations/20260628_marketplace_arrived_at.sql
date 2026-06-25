-- Add `arrived_at` column to marketplace_listings.
--
-- Schema-drift fix: the client read projection (`MARKETPLACE_COLUMNS` in
-- lib/supabase-marketplace-shapes.ts) already lists `arrived_at` in its
-- `select=`, and `rowToListing` reads `row.arrived_at`, but no migration ever
-- created the column. Against a real Supabase project the listings fetch
-- (`fetchListingsUrl` / `fetchListingByIdUrl`) therefore 400s with
-- "column marketplace_listings.arrived_at does not exist", breaking the whole
-- marketplace read path. The extended schema-parity test (BE-37) now catches
-- exactly this class of drift.
--
-- The column is nullable: a sold listing the buyer has physically received
-- carries the receipt timestamp; everything else stays NULL. This also lets
-- the "mark received" state (currently local-only via `markListingReceived`)
-- round-trip through the cloud in a later change without another migration.

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz NULL;
