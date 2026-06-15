-- pgTAP smoke test for the Supabase Tests CI harness (BE-31).
--
-- `supabase test db` loads pgTAP and runs every `supabase/tests/*.sql` file
-- against the local scratch database that `supabase db start` created by
-- applying `supabase/migrations/*` from empty. This file is the first such
-- test: it proves the harness works end-to-end and that the base-schema
-- migration (20260423_base_schema.sql) actually materialises the four core
-- tables and the folded-in ALTER columns on a from-empty replay.
--
-- Real RLS / FK-cascade pgTAP coverage lands in BE-12 / BE-36 alongside the
-- RLS lockdown; keep those in their own `supabase/tests/*.sql` files.

begin;

select plan(8);

-- The four core tables exist after a from-empty migration replay.
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'collections', 'collections table exists');
select has_table('public', 'items', 'items table exists');
select has_table('public', 'friend_requests', 'friend_requests table exists');

-- The historical ALTERs were folded into the base schema.
select has_column('public', 'profiles', 'display_currency', 'profiles.display_currency folded in');
select has_column('public', 'collections', 'currency', 'collections.currency folded in');
select has_column('public', 'items', 'cost_currency', 'items.cost_currency folded in');
select has_column('public', 'items', 'archived_at', 'items.archived_at folded in');

select * from finish();

rollback;
