-- Add `cost_currency` to items so a recorded cost carries its ISO 4217
-- currency (selected in the create-item form). Nullable: legacy items and
-- items saved without a cost keep NULL and render exactly as before.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS cost_currency text NULL;
