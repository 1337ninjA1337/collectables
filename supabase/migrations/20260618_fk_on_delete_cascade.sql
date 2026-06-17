-- BE-6 — make every cross-table foreign key carry an explicit ON DELETE
-- CASCADE so deleting an `auth.users` row (the terminal step of the
-- `delete-account` Edge Function) removes the account's owned data, and so
-- deleting a collection removes its items.
--
-- `20260423_base_schema.sql` already DEFINES these FKs with ON DELETE CASCADE
-- via `CREATE TABLE IF NOT EXISTS`. But the live project's tables were
-- originally created by hand in the Supabase dashboard, where the FKs may have
-- been added with the PostgreSQL default action (NO ACTION) instead of CASCADE.
-- `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so it can NOT
-- repair an existing FK's delete action — the table is left with whatever
-- constraint it already had. A NO ACTION FK would make `delete-account` fail
-- with a 23503 foreign_key_violation (leaving the account un-deletable) and
-- would block collection deletes that still have items.
--
-- This migration normalises the delete action for the six core FKs regardless
-- of their current name or action: for each (table, column) it drops ANY
-- existing foreign-key constraint on that column and re-adds a canonically
-- named one with ON DELETE CASCADE.
--
-- Idempotent: replaying just drops and re-adds the same CASCADE constraint, so
-- it is a no-op against the branch-preview / from-empty DB (where the base
-- schema already created these exact FKs). Dated 20260618 so it sorts after
-- 20260617_profiles_admin_update_grant.sql.
--
-- FKs normalised (all ON DELETE CASCADE):
--   profiles.id              -> auth.users (id)
--   collections.owner_user_id-> auth.users (id)
--   items.collection_id      -> public.collections (id)
--   items.created_by_user_id -> auth.users (id)
--   friend_requests.from_user_id -> auth.users (id)
--   friend_requests.to_user_id   -> auth.users (id)

-- Temp helper: drop every FK on (table, column) then add a CASCADE FK. Lives in
-- pg_temp so it is auto-dropped at session end (no explicit cleanup needed).
CREATE OR REPLACE FUNCTION pg_temp.ensure_cascade_fk(
  p_table     text,  -- target table in schema public
  p_column    text,  -- referencing column (single-column FK)
  p_ref       text,  -- fully-qualified referenced table, e.g. 'auth.users'
  p_ref_col   text,  -- referenced column
  p_conname   text   -- canonical constraint name to (re)create
) RETURNS void AS $$
DECLARE
  v_attnum smallint;
  c        record;
BEGIN
  SELECT attnum INTO v_attnum
  FROM pg_attribute
  WHERE attrelid = ('public.' || p_table)::regclass
    AND attname = p_column
    AND NOT attisdropped;

  -- Drop any existing single-column FK on this column, whatever its name.
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.conrelid = ('public.' || p_table)::regclass
      AND con.conkey = ARRAY[v_attnum]
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', p_table, c.conname);
  END LOOP;

  -- Re-add the FK with an explicit ON DELETE CASCADE.
  EXECUTE format(
    'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s (%I) ON DELETE CASCADE',
    p_table, p_conname, p_column, p_ref, p_ref_col
  );
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.ensure_cascade_fk('profiles',        'id',                 'auth.users',        'id', 'profiles_id_fkey');
SELECT pg_temp.ensure_cascade_fk('collections',     'owner_user_id',      'auth.users',        'id', 'collections_owner_user_id_fkey');
SELECT pg_temp.ensure_cascade_fk('items',           'collection_id',      'public.collections','id', 'items_collection_id_fkey');
SELECT pg_temp.ensure_cascade_fk('items',           'created_by_user_id', 'auth.users',        'id', 'items_created_by_user_id_fkey');
SELECT pg_temp.ensure_cascade_fk('friend_requests', 'from_user_id',       'auth.users',        'id', 'friend_requests_from_user_id_fkey');
SELECT pg_temp.ensure_cascade_fk('friend_requests', 'to_user_id',         'auth.users',        'id', 'friend_requests_to_user_id_fkey');
