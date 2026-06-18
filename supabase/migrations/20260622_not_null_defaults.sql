-- BE-10 — `NOT NULL` + defaults on the columns the client always guarantees.
--
-- `20260423_base_schema.sql` already DECLARES every one of these columns as
-- `NOT NULL DEFAULT <…>`, but — same gap class as BE-6/BE-7/BE-8 — the live
-- tables were hand-created in the dashboard, where a column may have been left
-- nullable or without a default, and `CREATE TABLE IF NOT EXISTS` can never
-- repair an *existing* column. A nullable `items.title` (etc.) lets a stray
-- partial write land a NULL that the read-path mappers in
-- `lib/supabase-profiles.ts` would propagate into a field typed as a plain
-- `string`, crashing downstream rendering (`row.username.toLowerCase()`,
-- `.map` on a null `photos`, …). The app-side `coerce*` validators
-- (`lib/supabase-row-coerce.ts`) are the belt; this migration is the braces:
-- the DB itself now guarantees the value the client always sends.
--
-- Scope: only the columns whose upsert body always emits a concrete value with
-- a safe scalar default — every `text … || ""`, the `text[]`/`uuid[]` arrays
-- (`?? []`), `is_wishlist` (`?? false`), `visibility` (`?? "private"`) and the
-- `created_at` timestamp. The uuid FK columns (`owner_user_id`,
-- `created_by_user_id`) are intentionally left out: they have no sensible
-- scalar default and their NOT NULL/FK integrity is owned by base_schema +
-- BE-6 (`20260618_fk_on_delete_cascade.sql`).
--
-- Each column is repaired in three idempotent steps: backfill any existing
-- NULLs to the default, `SET DEFAULT`, then `SET NOT NULL`. Re-applying (or
-- applying on top of a base_schema/branch-preview DB where the column is
-- already NOT NULL DEFAULT) is a no-op — the backfill matches zero rows and the
-- ALTERs restate the existing column shape.

-- NB: the outer block is tagged `$do$` (not `$$`) because the per-column
-- default literals below are themselves `$$…$$` dollar-quoted strings; an
-- untagged outer `$$` would be closed by the first inner `$$`, truncating the
-- block and surfacing as `syntax error at or near "::"`.
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- profiles (upsertProfileBody — always emits a string)
      ('profiles',    'email',                $$''$$),
      ('profiles',    'display_name',         $$''$$),
      ('profiles',    'username',             $$''$$),
      ('profiles',    'public_id',            $$''$$),
      ('profiles',    'bio',                  $$''$$),
      ('profiles',    'avatar',               $$''$$),
      -- collections (upsertCollectionBody)
      ('collections', 'name',                 $$''$$),
      ('collections', 'cover_photo',          $$''$$),
      ('collections', 'description',          $$''$$),
      ('collections', 'owner_name',           $$''$$),
      ('collections', 'visibility',           $$'private'$$),
      ('collections', 'shared_with_user_ids', $$'{}'::uuid[]$$),
      ('collections', 'created_at',           $$now()$$),
      -- items (upsertItemBody)
      ('items',       'title',                $$''$$),
      ('items',       'acquired_at',          $$''$$),
      ('items',       'acquired_from',        $$''$$),
      ('items',       'description',          $$''$$),
      ('items',       'variants',             $$''$$),
      ('items',       'created_by',           $$''$$),
      ('items',       'photos',               $$'{}'::text[]$$),
      ('items',       'is_wishlist',          $$false$$),
      ('items',       'created_at',           $$now()$$)
    ) AS v(tbl, col, deflt)
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = %s WHERE %I IS NULL',
      r.tbl, r.col, r.deflt, r.col
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT %s',
      r.tbl, r.col, r.deflt
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL',
      r.tbl, r.col
    );
  END LOOP;
END $do$;
