-- Add `display_currency` to profiles so the user's app-wide display currency
-- (ISO 4217) follows their account across devices instead of living only in
-- device-local AsyncStorage. Nullable: existing rows keep NULL and fall back
-- to the device-local preference, then the language default. See bug-2c.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_currency text NULL;
