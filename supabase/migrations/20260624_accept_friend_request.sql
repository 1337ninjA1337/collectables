-- BE-21 — server-authoritative, transactional friend-request acceptance.
--
-- A friendship is mutual: it exists only when BOTH directed rows are present
-- in `friend_requests` (A→B and B→A — see the BE-9 `is_friend` helper and the
-- chat "friends only" insert policy). "Accepting" an incoming request is
-- therefore just inserting the reverse direction. Doing that purely
-- client-side (a plain `INSERT` of the acceptor→sender row) has a gap: it never
-- checks that the inbound sender→acceptor request still exists. If the sender
-- withdrew their request concurrently, the client insert succeeds anyway and
-- leaves a dangling one-way row that *looks* like the acceptor sent a brand-new
-- request to the sender — the opposite of what the user intended.
--
-- This function closes that gap server-side and makes the flip transactional.
-- It locks the inbound request row `FOR UPDATE` (so a concurrent withdrawal
-- blocks until this accept commits), raises if it is gone, then inserts the
-- reverse direction idempotently. Both directions therefore become present —
-- or neither does — atomically.
--
-- It is `SECURITY DEFINER` so it can read/write `friend_requests` regardless of
-- the caller's RLS, but it is granted ONLY to `service_role`: it takes the
-- acceptor id as an explicit parameter (it does not trust `auth.uid()`), so it
-- must never be exposed to anon/authenticated PostgREST callers — the
-- `accept-friend-request` Edge Function (which validates the caller via
-- `auth.getUser()` and passes that id as `p_to_user_id`) is the only caller.
--
-- Idempotent to re-apply: `CREATE OR REPLACE FUNCTION` + idempotent GRANT/REVOKE.

CREATE OR REPLACE FUNCTION public.accept_friend_request(
  p_from_user_id uuid,
  p_to_user_id   uuid
)
RETURNS TABLE (from_user_id uuid, to_user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'both user ids are required' USING errcode = '22023';
  END IF;
  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'cannot accept your own request' USING errcode = '22023';
  END IF;

  -- Lock the inbound request (sender → acceptor) so a concurrent withdrawal
  -- blocks until this accept commits — this is what makes the flip atomic.
  PERFORM 1
    FROM public.friend_requests fr
   WHERE fr.from_user_id = p_from_user_id
     AND fr.to_user_id = p_to_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no pending friend request' USING errcode = 'P0002';
  END IF;

  -- Insert the reverse direction (acceptor → sender). Idempotent: a re-accept
  -- (both directions already present) is a harmless no-op.
  INSERT INTO public.friend_requests (from_user_id, to_user_id)
  VALUES (p_to_user_id, p_from_user_id)
  ON CONFLICT (from_user_id, to_user_id) DO NOTHING;

  RETURN QUERY
    SELECT fr.from_user_id, fr.to_user_id
      FROM public.friend_requests fr
     WHERE (fr.from_user_id = p_from_user_id AND fr.to_user_id = p_to_user_id)
        OR (fr.from_user_id = p_to_user_id AND fr.to_user_id = p_from_user_id);
END;
$$;

-- Server-only: the function trusts its `p_to_user_id` argument, so it must
-- never be callable by an end-user PostgREST session (which could pass any id).
REVOKE ALL ON FUNCTION public.accept_friend_request(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_friend_request(uuid, uuid) TO service_role;
