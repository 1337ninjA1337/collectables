-- BE-11a — lock down the four core tables with Row Level Security.
--
-- `profiles`, `collections`, `items`, `friend_requests` were created in
-- `20260423_base_schema.sql` WITHOUT any RLS (the base-schema migration only
-- established column shape + keys, deferring the security model to this
-- phase). Until now a crafted client holding any authenticated token could
-- read or write every row in those tables. This migration:
--
--   * enables RLS on all four tables, and
--   * grants the narrow per-table policies the app actually relies on, so the
--     UI gates (own data, public/shared/friend visibility, friends-only) are
--     enforced server-side rather than purely client-side.
--
-- chat (`20260424_chat_messages.sql`, `20260501_chat_reads.sql`),
-- marketplace (`20260502_marketplace_listings.sql`,
-- `20260527_marketplace_transfers.sql`) and analytics
-- (`20260508_analytics_events.sql`) already ship their own RLS, so they are
-- intentionally untouched here.
--
-- Visibility primitives are SECURITY DEFINER functions so a policy on one
-- table can consult another (e.g. items → collections → friend_requests)
-- without tripping that table's own RLS or recursing. The functions run with
-- the definer's (owner / superuser) privileges, which bypass RLS on their
-- internal lookups.
--
-- The migration is idempotent: `CREATE OR REPLACE FUNCTION`,
-- `ADD COLUMN IF NOT EXISTS`, and `DROP POLICY IF EXISTS` before each
-- `CREATE POLICY` (PostgreSQL ≤16 has no `CREATE POLICY IF NOT EXISTS`), so it
-- is safe to replay against a branch-preview DB where objects survive.

-- ---------------------------------------------------------------------------
-- Admin flag — moves the hardcoded `1337antoxa` / email allowlist out of the
-- client (`lib/social-context.tsx`) and onto the row, so admin powers are
-- server-enforceable. App-side wiring to READ this flag lands in BE-11b.
--
-- REVOKE UPDATE on the column from end-user roles so a crafted PATCH on a
-- caller's own profile row (allowed by the profiles UPDATE policy below)
-- cannot self-promote to admin. Column privileges are checked independently
-- of (and in addition to) RLS policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated;
REVOKE UPDATE (is_admin) ON public.profiles FROM anon;

-- ---------------------------------------------------------------------------
-- Visibility helpers (SECURITY DEFINER, STABLE).
-- `search_path` is pinned so a caller cannot shadow `public` with a malicious
-- temp schema and hijack the definer-privileged lookup.
-- ---------------------------------------------------------------------------

-- Mutual friendship: both directed friend_requests rows exist (A→B and B→A),
-- mirroring the chat_messages "friends only" insert policy.
CREATE OR REPLACE FUNCTION public.is_friend(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a IS NOT NULL
    AND b IS NOT NULL
    AND a <> b
    AND EXISTS (
      SELECT 1 FROM public.friend_requests fr
      WHERE fr.from_user_id = a AND fr.to_user_id = b
    )
    AND EXISTS (
      SELECT 1 FROM public.friend_requests fr
      WHERE fr.from_user_id = b AND fr.to_user_id = a
    );
$$;

-- A viewer can "see" an owner's social surface when they ARE the owner or are
-- mutual friends. This is the task-named primitive the collection/item
-- policies build on.
CREATE OR REPLACE FUNCTION public.is_visible_to(viewer uuid, owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT viewer IS NOT NULL
    AND owner IS NOT NULL
    AND (viewer = owner OR public.is_friend(viewer, owner));
$$;

-- Full per-collection visibility: owner, OR a public collection, OR explicitly
-- shared with the viewer, OR the owner is visible to the viewer (friendship).
-- Used by both the collections SELECT policy and the items SELECT policy so
-- the rule lives in exactly one place.
CREATE OR REPLACE FUNCTION public.can_view_collection(viewer uuid, cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = cid
      AND (
        c.owner_user_id = viewer
        OR c.visibility = 'public'
        OR viewer = ANY (c.shared_with_user_ids)
        OR public.is_visible_to(viewer, c.owner_user_id)
      )
  );
$$;

-- Admin check, sourced from profiles.is_admin.
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT uid IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = uid AND p.is_admin
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_friend(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_visible_to(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_collection(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- profiles — a public directory of authenticated users.
--   SELECT: any signed-in user (the people browser lists everyone).
--   INSERT/UPDATE: only your own row.
--   DELETE: your own row, or any row if you are an admin (the admin
--           "delete profile" action in social-context / profile/[id]).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated"
ON public.profiles
FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_delete_own_or_admin"
ON public.profiles
FOR DELETE
USING (auth.uid() = id OR public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- collections — owner-writable, visibility-gated reads.
--   SELECT: owner, public, shared-with, or friend-of-owner (can_view_collection).
--   INSERT/UPDATE/DELETE: only the owner.
-- ---------------------------------------------------------------------------
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collections_select_visible" ON public.collections;
CREATE POLICY "collections_select_visible"
ON public.collections
FOR SELECT
USING (public.can_view_collection(auth.uid(), id));

DROP POLICY IF EXISTS "collections_insert_own" ON public.collections;
CREATE POLICY "collections_insert_own"
ON public.collections
FOR INSERT
WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "collections_update_own" ON public.collections;
CREATE POLICY "collections_update_own"
ON public.collections
FOR UPDATE
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "collections_delete_own" ON public.collections;
CREATE POLICY "collections_delete_own"
ON public.collections
FOR DELETE
USING (auth.uid() = owner_user_id);

-- ---------------------------------------------------------------------------
-- items — reads follow the parent collection's visibility; writes require
-- ownership of the parent collection (which matches created_by_user_id today).
--   SELECT: can_view_collection(viewer, collection_id).
--   INSERT/UPDATE/DELETE: creator AND owner of the parent collection.
-- ---------------------------------------------------------------------------
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "items_select_visible" ON public.items;
CREATE POLICY "items_select_visible"
ON public.items
FOR SELECT
USING (public.can_view_collection(auth.uid(), collection_id));

DROP POLICY IF EXISTS "items_insert_own_collection" ON public.items;
CREATE POLICY "items_insert_own_collection"
ON public.items
FOR INSERT
WITH CHECK (
  auth.uid() = created_by_user_id
  AND EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = items.collection_id AND c.owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "items_update_own_collection" ON public.items;
CREATE POLICY "items_update_own_collection"
ON public.items
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = items.collection_id AND c.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = items.collection_id AND c.owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "items_delete_own_collection" ON public.items;
CREATE POLICY "items_delete_own_collection"
ON public.items
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = items.collection_id AND c.owner_user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- friend_requests — a directed request is readable/removable by either party;
-- only the sender may create it. Rows are immutable (no UPDATE policy): a
-- mutual friendship is encoded as both directed rows existing, and unfriending
-- is a DELETE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friend_requests_select_party" ON public.friend_requests;
CREATE POLICY "friend_requests_select_party"
ON public.friend_requests
FOR SELECT
USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

DROP POLICY IF EXISTS "friend_requests_insert_sender" ON public.friend_requests;
CREATE POLICY "friend_requests_insert_sender"
ON public.friend_requests
FOR INSERT
WITH CHECK (auth.uid() = from_user_id AND from_user_id <> to_user_id);

DROP POLICY IF EXISTS "friend_requests_delete_party" ON public.friend_requests;
CREATE POLICY "friend_requests_delete_party"
ON public.friend_requests
FOR DELETE
USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);
