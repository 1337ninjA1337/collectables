-- Add `currency` to collections so a per-collection ISO 4217 currency
-- override (selected from the edit modal or the tap-to-swap chip on the
-- total-cost summary card) controls which currency the aggregated totals
-- are displayed in. Nullable: legacy collections without an override keep
-- NULL and fall back to the user's app-wide displayCurrency.

ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS currency text NULL;
