-- BE-7 — guarantee the data-integrity CHECK constraints + the friend-request
-- uniqueness exist on the *existing* (hand-created) live tables.
--
-- `20260423_base_schema.sql` already DEFINES these constraints inline:
--   collections.visibility CHECK (visibility IN ('public','private'))
--   items.condition        CHECK (condition IN ('new','excellent','good','fair'))
--   friend_requests        CHECK (from_user_id <> to_user_id)  [no self-request]
--   friend_requests        UNIQUE (from_user_id, to_user_id)   [directed pair]
-- but, exactly as with the FKs in BE-6, `CREATE TABLE IF NOT EXISTS` is a no-op
-- on a table that already exists, so it can NOT add a missing CHECK / UNIQUE to
-- the live tables that were created by hand in the Supabase dashboard. This
-- migration backfills them idempotently.
--
-- Two parts of the BE-7 brief are intentionally NOT implemented, because they
-- don't match the actual schema/data model:
--
--   * "collections.role IN ('owner','viewer')" — `role` is NOT a database
--     column. It is derived client-side (see `toCollection` in
--     lib/supabase-profiles.ts, which hardcodes role:"viewer" for fetched rows;
--     ownership is computed from owner_user_id == auth.uid()). There is nothing
--     to CHECK in the DB.
--
--   * "friend_requests UNIQUE on least/greatest(from,to)" — an *undirected*
--     unique key would FORBID the reciprocal row, but this app represents a
--     confirmed mutual friendship precisely BY both directed rows existing
--     (A->B and B->A); the chat_messages "friends only" insert policy depends
--     on it. The correct key is the *directed* pair unique (kept below).
--
-- Idempotent: each ADD is guarded so replaying against the base-schema /
-- branch-preview DB (where the inline constraints already exist) is a no-op.
-- Dated 20260619 so it sorts after 20260618_fk_on_delete_cascade.sql.

-- collections.visibility enum CHECK ------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.collections'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%visibility%'
  ) THEN
    ALTER TABLE public.collections
      ADD CONSTRAINT collections_visibility_check
      CHECK (visibility IN ('public', 'private'));
  END IF;
END $$;

-- items.condition enum CHECK -------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.items'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%condition%'
  ) THEN
    ALTER TABLE public.items
      ADD CONSTRAINT items_condition_check
      CHECK (condition IN ('new', 'excellent', 'good', 'fair'));
  END IF;
END $$;

-- friend_requests no-self CHECK ----------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.friend_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%<>%'
  ) THEN
    ALTER TABLE public.friend_requests
      ADD CONSTRAINT friend_requests_no_self
      CHECK (from_user_id <> to_user_id);
  END IF;
END $$;

-- friend_requests directed-pair uniqueness (natively idempotent) -------------
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair_key
  ON public.friend_requests (from_user_id, to_user_id);
