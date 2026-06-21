-- BE-22a — server-authoritative premium entitlement: the `subscriptions` table.
--
-- Until now "premium" lived purely in AsyncStorage (`collectables-premium-v1-*`
-- via `lib/premium-context.tsx`), so any client could grant itself paid
-- features by writing the flag locally — the entitlement was never validated
-- server-side. This migration introduces the durable, server-authoritative
-- source of truth: one row per user describing their subscription state.
--
-- The row is written ONLY by the service-role `validate-premium` Edge Function
-- (BE-22b) — never by an end-user PostgREST session — exactly like the
-- `claim-listing`/`accept_friend_request` server-authoritative paths. We
-- therefore:
--   * enable RLS and grant the caller a SELECT policy on their OWN row only
--     (so the app can read its cached entitlement directly), and
--   * grant NO INSERT/UPDATE/DELETE policy to anon/authenticated, so a crafted
--     client cannot mint or extend its own subscription. service_role bypasses
--     RLS, so the Edge Function still writes freely.
--
-- Columns:
--   user_id            PK + FK→auth.users, ON DELETE CASCADE so a deleted
--                      account's entitlement vanishes with it (BE-25/BE-6).
--   status             'active' | 'inactive' | 'expired' | 'cancelled'.
--   activated_at       when the current active period began (NULL when never).
--   current_period_end when the active period lapses (NULL = no expiry yet).
--   created_at/updated_at  standard timestamps; updated_at auto-bumps via the
--                      BE-9 moddatetime trigger so delta pulls carry the change.
--   deleted_at         soft-delete tombstone (BE-15) for uniform retention.
--
-- Idempotent to re-apply: CREATE TABLE / ADD COLUMN / CREATE INDEX … IF NOT
-- EXISTS, DROP TRIGGER/POLICY IF EXISTS before each CREATE.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id            uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'inactive'
                       CHECK (status IN ('active', 'inactive', 'expired', 'cancelled')),
  activated_at       timestamptz,
  current_period_end timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

-- Auto-bump updated_at on every mutation (BE-9 moddatetime convention).
DROP TRIGGER IF EXISTS handle_updated_at ON public.subscriptions;
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Partial "alive" index (BE-15 soft-delete convention).
CREATE INDEX IF NOT EXISTS subscriptions_alive_idx
  ON public.subscriptions (deleted_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Owner may read their own entitlement (so the client can hydrate its cache).
DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;
CREATE POLICY subscriptions_select_own
  ON public.subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy: writes are service_role-only (the
-- `validate-premium` Edge Function). A user can never grant or extend their own
-- subscription via PostgREST.
