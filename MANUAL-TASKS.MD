# Manual Tasks

These DB changes must be applied manually to the Supabase project (or will be auto-applied via the `supabase db push` CI step if `SUPABASE_DB_URL` secret is set).

## 20260502_marketplace_listings.sql

Run `supabase/migrations/20260502_marketplace_listings.sql` against your Supabase project:

```sql
-- Creates public.marketplace_listings table with RLS policies:
--   * Any authenticated user can SELECT listings
--   * Users can only INSERT/UPDATE/DELETE their own listings
```

Either apply it via the Supabase SQL editor, or add the `SUPABASE_DB_URL` secret to GitHub and the deploy workflow will run `supabase db push` automatically.

## 20260507_marketplace_buyer.sql

Run `supabase/migrations/20260507_marketplace_buyer.sql` against your Supabase project:

```sql
-- Adds the nullable buyer_user_id column on marketplace_listings so a sold
-- listing remembers who acquired the item (foundation for the full
-- trade cycle: transfer history, profile transfers section, etc.).
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS buyer_user_id uuid NULL
    REFERENCES auth.users (id) ON DELETE SET NULL;
```

Apply it via the Supabase SQL editor, or rely on the `supabase db push` CI step.
