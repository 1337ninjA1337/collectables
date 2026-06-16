-- SEC-ADMIN-1 — close the profiles.is_admin self-promotion hole.
--
-- `20260616_core_tables_rls.sql` protected the admin flag with a *column-level*
-- REVOKE:
--
--     REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated;
--
-- but in PostgreSQL a *table-level* UPDATE grant covers every column and
-- silently satisfies the per-column privilege check, so a column-level REVOKE
-- is a no-op whenever the role also holds table-level UPDATE. Supabase's
-- default project bootstrap typically runs `GRANT ALL ... TO authenticated`
-- (table-level) on `public` tables, which means the previous REVOKE never
-- actually fired: any authenticated user could PATCH their own profile row
-- (allowed by the `profiles_update_own` policy) setting `is_admin = true`,
-- escalating to admin — which then permits deleting ANY profile via
-- `profiles_delete_own_or_admin`. This was confirmed empirically in the
-- BE-12b pgTAP run.
--
-- Fix: drop the broad table-level UPDATE and re-grant UPDATE explicitly on
-- every column EXCEPT `is_admin`. With no table-level grant remaining, the
-- per-column grant is authoritative and `is_admin` can never be client-written.
--
-- Idempotent: REVOKE/GRANT are declarative, so replaying against a
-- branch-preview DB is a no-op. Dated 20260617 (not 20260616) so it sorts
-- AFTER `20260616_core_tables_rls.sql` — a same-day all-digit suffix would sort
-- before that file's `_core…` and run before the `is_admin` column exists.

-- Defense in depth: remove ALL table-level UPDATE the bootstrap may have
-- granted, then re-grant per column. anon never updates profiles, so it gets
-- no per-column grant back.
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;

-- Re-grant UPDATE on every profiles column EXCEPT is_admin. This list must
-- track the profiles columns in 20260423_base_schema.sql (+ folded ALTERs):
-- id, email, display_name, username, public_id, bio, avatar,
-- display_currency, created_at, is_admin. is_admin is intentionally omitted.
GRANT UPDATE (
  id,
  email,
  display_name,
  username,
  public_id,
  bio,
  avatar,
  display_currency,
  created_at
) ON public.profiles TO authenticated;

-- NOTE (consideration #3 from SEC-ADMIN-1): admin promotion remains a purely
-- server-side / out-of-band operation. There is no client write path to
-- is_admin at all — the column is set via the service-role key (SQL console or
-- a future Edge Function). `lib/supabase-profiles-shapes.ts:upsertProfileBody`
-- deliberately omits is_admin, and BE-11b reads the flag read-only.
