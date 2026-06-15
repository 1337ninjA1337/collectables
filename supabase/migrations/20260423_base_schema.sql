-- Base schema: authoritative, reproducible definitions for the four core
-- tables the app reads/writes through the Supabase REST API — `profiles`,
-- `collections`, `items`, `friend_requests`.
--
-- Until now these tables only existed in the live Supabase project (created
-- by hand in the dashboard), with later `ALTER`s tracked as one-off
-- migrations (`items.cost_currency`, `collections.currency`,
-- `items.archived_at`, `profiles.display_currency`). This migration folds all
-- of that into a single `CREATE TABLE … IF NOT EXISTS` definition so a fresh
-- project can be bootstrapped from the committed migrations alone (see BE-1 /
-- MANUAL-TASKS.md / the schema-parity test).
--
-- Every column here is derived from the REST URL/body builders in
-- `lib/supabase-profiles-shapes.ts` + the `DbProfile`/`DbCollection`/`DbItem`
-- row shapes in `lib/supabase-profiles.ts` and the domain types in
-- `lib/types.ts`. It is intentionally idempotent (`IF NOT EXISTS`
-- everywhere) so it is safe to apply on top of the existing live schema:
-- existing tables/columns are left untouched, missing ones are added.
--
-- RLS lockdown lives in a later phase (BE-11/BE-12); this migration only
-- establishes the column shape, keys, and FKs.

-- ---------------------------------------------------------------------------
-- profiles — one row per authenticated user (id == auth.users.id).
-- Source: upsertProfileBody / profilesPageUrl (order=created_at.desc) /
-- DbProfile.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id               uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email            text        NOT NULL DEFAULT '',
  display_name     text        NOT NULL DEFAULT '',
  username         text        NOT NULL DEFAULT '',
  public_id        text        NOT NULL DEFAULT '',
  bio              text        NOT NULL DEFAULT '',
  avatar           text        NOT NULL DEFAULT '',
  -- App-wide display currency (ISO 4217), synced across devices. Nullable:
  -- falls back to the device-local preference, then the language default.
  display_currency text        NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Fold in 20260528_profile_display_currency for pre-existing tables.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_currency text NULL;

-- public_id (slug) and username are user-facing lookup keys and must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_public_id_key ON public.profiles (public_id);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key  ON public.profiles (username);

-- ---------------------------------------------------------------------------
-- collections — a user's collection of items.
-- Source: upsertCollectionBody / collectionsByUserUrl (order=created_at.desc,
-- name=neq.__wishlist__) / publicCollectionsByUserUrl (visibility=eq.public) /
-- DbCollection.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collections (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL DEFAULT '',
  cover_photo           text        NOT NULL DEFAULT '',
  description           text        NOT NULL DEFAULT '',
  owner_name            text        NOT NULL DEFAULT '',
  owner_user_id         uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  sort_order            integer     NULL,
  visibility            text        NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  shared_with_user_ids  uuid[]      NOT NULL DEFAULT '{}',
  -- Per-collection ISO 4217 currency override for aggregated totals.
  -- Nullable: falls back to the user's app-wide display_currency.
  currency              text        NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Fold in 20260523_collection_currency for pre-existing tables.
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS currency text NULL;

CREATE INDEX IF NOT EXISTS collections_owner_user_id_idx ON public.collections (owner_user_id);

-- ---------------------------------------------------------------------------
-- items — a collectable belonging to a collection.
-- Source: upsertItemBody / itemsByCollectionUrl (order=created_at.desc) /
-- DbItem (is_wishlist / created_by_user_id read paths in supabase-profiles.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id       uuid        NOT NULL REFERENCES public.collections (id) ON DELETE CASCADE,
  title               text        NOT NULL DEFAULT '',
  acquired_at         text        NOT NULL DEFAULT '',
  acquired_from       text        NOT NULL DEFAULT '',
  description         text        NOT NULL DEFAULT '',
  variants            text        NOT NULL DEFAULT '',
  photos              text[]      NOT NULL DEFAULT '{}',
  created_by          text        NOT NULL DEFAULT '',
  created_by_user_id  uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  cost                numeric     NULL,
  -- ISO 4217 currency for `cost` (20260517_items_cost_currency).
  cost_currency       text        NULL,
  sort_order          integer     NULL,
  is_wishlist         boolean     NOT NULL DEFAULT false,
  condition           text        NULL CHECK (condition IN ('new', 'excellent', 'good', 'fair')),
  tags                jsonb       NULL,
  -- Set when the seller soft-archives an item after a sale
  -- (20260527142510_items_archived_at). Nullable: live items keep NULL.
  archived_at         timestamptz NULL
);

-- Fold in the item ALTERs for pre-existing tables.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS cost_currency text NULL;
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS items_collection_id_idx ON public.items (collection_id);
CREATE INDEX IF NOT EXISTS items_wishlist_idx ON public.items (created_by_user_id, is_wishlist);

-- ---------------------------------------------------------------------------
-- friend_requests — one row per directed request. Both directions present
-- (A→B and B→A) means a confirmed mutual friendship (see the chat_messages
-- "friends only" insert policy).
-- Source: friendRequestsInsertUrl / friendRequestsUrl (select
-- from_user_id,to_user_id) / sendFriendRequestBody / removeFriendRequestUrl.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id  uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  to_user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- A user cannot send a request to themselves.
  CONSTRAINT friend_requests_no_self CHECK (from_user_id <> to_user_id)
);

-- At most one directed request per ordered pair.
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair_key
  ON public.friend_requests (from_user_id, to_user_id);

-- Hot read path: "all requests involving me" (friendRequestsUrl OR-filter).
CREATE INDEX IF NOT EXISTS friend_requests_from_idx ON public.friend_requests (from_user_id);
CREATE INDEX IF NOT EXISTS friend_requests_to_idx   ON public.friend_requests (to_user_id);
