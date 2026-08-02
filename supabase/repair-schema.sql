-- Schema repair — run this ONCE in the Supabase SQL editor to clear the
-- `400 (Bad Request)` storm on every `/rest/v1/*` read.
--
-- WHY THIS EXISTS
-- ---------------
-- `lib/supabase-profiles-shapes.ts` and `lib/supabase-marketplace-shapes.ts`
-- request explicit column projections rather than `select=*`. PostgREST answers
-- the WHOLE request with `400 … 42703 column … does not exist` when even one
-- projected column is missing, so a single un-applied migration takes down
-- profiles, collections, items and marketplace listings at once — which is
-- exactly what the deployed app shows.
--
-- This script is the fast path: it adds every column those projections read,
-- and nothing else. It does NOT replace `supabase/migrations/` — RLS policies,
-- indexes, foreign keys, triggers and the retention sweeps all still live
-- there. It only gets reads working again.
--
-- SAFE TO RE-RUN. Every statement is `IF NOT EXISTS`-guarded and additive: no
-- column is dropped, retyped or backfilled, and a column that already exists is
-- left exactly as it is. Tables that do not exist yet are skipped rather than
-- created — if this script reports a skipped table, that table's migration in
-- `supabase/migrations/` has never been applied and you need the full push
-- (see MANUAL-TASKS.md).

begin;

-- profiles -------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profiles') is null then
    raise notice 'SKIPPED public.profiles — table does not exist; apply supabase/migrations/20260423_base_schema.sql';
  else
    alter table public.profiles add column if not exists email            text        not null default '';
    alter table public.profiles add column if not exists display_name     text        not null default '';
    alter table public.profiles add column if not exists username         text        not null default '';
    alter table public.profiles add column if not exists public_id        text        not null default '';
    alter table public.profiles add column if not exists bio              text        not null default '';
    alter table public.profiles add column if not exists avatar           text        not null default '';
    alter table public.profiles add column if not exists display_currency text        null;
    -- Server-authoritative: the client reads it, never writes it (the UPDATE
    -- grant is REVOKEd in 20260616_core_tables_rls.sql).
    alter table public.profiles add column if not exists is_admin         boolean     not null default false;
    alter table public.profiles add column if not exists created_at       timestamptz not null default now();
  end if;
end $$;

-- collections ----------------------------------------------------------------
do $$
begin
  if to_regclass('public.collections') is null then
    raise notice 'SKIPPED public.collections — table does not exist; apply supabase/migrations/20260423_base_schema.sql';
  else
    alter table public.collections add column if not exists name                 text        not null default '';
    alter table public.collections add column if not exists cover_photo          text        not null default '';
    alter table public.collections add column if not exists description          text        not null default '';
    alter table public.collections add column if not exists owner_name           text        not null default '';
    alter table public.collections add column if not exists sort_order           integer     null;
    alter table public.collections add column if not exists visibility           text        not null default 'private';
    alter table public.collections add column if not exists shared_with_user_ids uuid[]      not null default '{}';
    alter table public.collections add column if not exists currency             text        null;
    alter table public.collections add column if not exists created_at           timestamptz not null default now();
    -- Delta-pull cursor (20260621) + tombstone filter (20260623). Both are read
    -- on every sync, so a missing one 400s the whole collections list.
    alter table public.collections add column if not exists updated_at           timestamptz not null default now();
    alter table public.collections add column if not exists deleted_at           timestamptz null;
  end if;
end $$;

-- items ----------------------------------------------------------------------
do $$
begin
  if to_regclass('public.items') is null then
    raise notice 'SKIPPED public.items — table does not exist; apply supabase/migrations/20260423_base_schema.sql';
  else
    alter table public.items add column if not exists title              text        not null default '';
    alter table public.items add column if not exists acquired_at        text        not null default '';
    alter table public.items add column if not exists acquired_from      text        not null default '';
    alter table public.items add column if not exists description        text        not null default '';
    alter table public.items add column if not exists variants           text        not null default '';
    alter table public.items add column if not exists photos             text[]      not null default '{}';
    alter table public.items add column if not exists created_by         text        not null default '';
    alter table public.items add column if not exists created_at         timestamptz not null default now();
    alter table public.items add column if not exists cost               numeric     null;
    alter table public.items add column if not exists cost_currency      text        null;
    alter table public.items add column if not exists sort_order         integer     null;
    alter table public.items add column if not exists is_wishlist        boolean     not null default false;
    alter table public.items add column if not exists condition          text        null;
    alter table public.items add column if not exists tags               jsonb       null;
    alter table public.items add column if not exists archived_at        timestamptz null;
    alter table public.items add column if not exists updated_at         timestamptz not null default now();
    alter table public.items add column if not exists deleted_at         timestamptz null;
  end if;
end $$;

-- marketplace_listings -------------------------------------------------------
do $$
begin
  if to_regclass('public.marketplace_listings') is null then
    raise notice 'SKIPPED public.marketplace_listings — table does not exist; apply supabase/migrations/20260502_marketplace_listings.sql';
  else
    alter table public.marketplace_listings add column if not exists mode          text        not null default 'sale';
    alter table public.marketplace_listings add column if not exists asking_price  numeric     null;
    alter table public.marketplace_listings add column if not exists currency      text        null;
    alter table public.marketplace_listings add column if not exists notes         text        not null default '';
    alter table public.marketplace_listings add column if not exists created_at    timestamptz not null default now();
    alter table public.marketplace_listings add column if not exists sold_at       timestamptz null;
    alter table public.marketplace_listings add column if not exists buyer_user_id uuid        null;
    alter table public.marketplace_listings add column if not exists arrived_at    timestamptz null;
  end if;
end $$;

commit;

-- PostgREST caches the schema. Without this the API can keep answering 400
-- ("Could not find the '…' column of '…' in the schema cache") for up to a few
-- minutes after the columns exist.
notify pgrst, 'reload schema';

-- Verification — this should return ZERO rows. Any row it does return is a
-- column the app still selects but the database still lacks.
with expected(tbl, col) as (
  values
    ('profiles','email'), ('profiles','display_name'), ('profiles','username'),
    ('profiles','public_id'), ('profiles','bio'), ('profiles','avatar'),
    ('profiles','display_currency'), ('profiles','is_admin'),
    ('collections','name'), ('collections','cover_photo'), ('collections','description'),
    ('collections','owner_name'), ('collections','owner_user_id'), ('collections','sort_order'),
    ('collections','visibility'), ('collections','shared_with_user_ids'), ('collections','currency'),
    ('collections','created_at'), ('collections','updated_at'), ('collections','deleted_at'),
    ('items','collection_id'), ('items','title'), ('items','acquired_at'), ('items','acquired_from'),
    ('items','description'), ('items','variants'), ('items','photos'), ('items','created_by'),
    ('items','created_by_user_id'), ('items','created_at'), ('items','cost'), ('items','cost_currency'),
    ('items','sort_order'), ('items','is_wishlist'), ('items','condition'), ('items','tags'),
    ('items','archived_at'), ('items','updated_at'), ('items','deleted_at'),
    ('marketplace_listings','item_id'), ('marketplace_listings','owner_user_id'),
    ('marketplace_listings','mode'), ('marketplace_listings','asking_price'),
    ('marketplace_listings','currency'), ('marketplace_listings','notes'),
    ('marketplace_listings','created_at'), ('marketplace_listings','sold_at'),
    ('marketplace_listings','buyer_user_id'), ('marketplace_listings','arrived_at')
)
select e.tbl as still_missing_table, e.col as still_missing_column
from expected e
left join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = e.tbl and c.column_name = e.col
where c.column_name is null
order by e.tbl, e.col;
