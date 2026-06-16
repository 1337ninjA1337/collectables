-- BE-12b — executable pgTAP coverage for the core-table RLS lockdown shipped
-- in 20260616_core_tables_rls.sql.
--
-- `supabase test db` runs this against the local scratch database that
-- `supabase db start` built by replaying supabase/migrations/* from empty
-- (Docker runner only — this file is NOT exercised by the offline JS suite;
-- BE-12a covers the structural/file-scan half). It seeds auth.users +
-- profiles/collections/items/friend_requests, switches roles via
-- `request.jwt.claims`, and asserts:
--   * the SECURITY DEFINER visibility helpers
--     (is_friend / is_visible_to / can_view_collection / is_admin), and
--   * cross-tenant SELECT/INSERT/UPDATE/DELETE deny + owner/friend/public/shared
--     allow on every core table.
--
-- Actors:
--   alice  — owner of the test collections/items.
--   bob    — mutual friend of alice (both directed friend_requests exist).
--   carol  — stranger: shared on one collection, sent alice a one-way request.
--   admin  — profiles.is_admin = true.

begin;

select plan(38);

-- ---------------------------------------------------------------------------
-- Seed (runs as the privileged test session role — bypasses RLS).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a11c', 'alice@test.dev'),
  ('00000000-0000-0000-0000-00000000b0b0', 'bob@test.dev'),
  ('00000000-0000-0000-0000-00000000ca01', 'carol@test.dev'),
  ('00000000-0000-0000-0000-0000000ad311', 'admin@test.dev');

insert into public.profiles (id, email, username, public_id, is_admin) values
  ('00000000-0000-0000-0000-00000000a11c', 'alice@test.dev', 'alice', 'alice', false),
  ('00000000-0000-0000-0000-00000000b0b0', 'bob@test.dev',   'bob',   'bob',   false),
  ('00000000-0000-0000-0000-00000000ca01', 'carol@test.dev', 'carol', 'carol', false),
  ('00000000-0000-0000-0000-0000000ad311', 'admin@test.dev', 'admin', 'admin', true);

insert into public.collections (id, owner_user_id, name, visibility, shared_with_user_ids) values
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000a11c', 'private', 'private', '{}'),
  ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-00000000a11c', 'public',  'public',  '{}'),
  ('00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-00000000a11c', 'shared',  'private', '{00000000-0000-0000-0000-00000000ca01}');

insert into public.items (id, collection_id, created_by_user_id, title) values
  ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000a11c', 'secret item');

insert into public.friend_requests (from_user_id, to_user_id) values
  ('00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-00000000b0b0'), -- alice -> bob
  ('00000000-0000-0000-0000-00000000b0b0', '00000000-0000-0000-0000-00000000a11c'), -- bob -> alice  (=> mutual)
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000a11c'); -- carol -> alice (one-way)

-- The local scratch DB built by `supabase db start` does NOT run Supabase's
-- hosted role bootstrap, so the `authenticated` role has no table privileges
-- here — in production those come from `grant all ... to authenticated`. Grant
-- them so these tests exercise RLS row-filtering rather than a missing GRANT,
-- then re-apply the column-level REVOKE the RLS migration relies on (the fresh
-- table-level UPDATE grant would otherwise re-enable writes to is_admin and
-- mask the self-promotion deny test below).
grant usage on schema public to authenticated;
grant select, insert, delete on all tables in schema public to authenticated;
grant update on public.collections, public.items, public.friend_requests to authenticated;
-- profiles.is_admin is protected by a column-level REVOKE in the RLS migration.
-- A *table-level* UPDATE grant would cover every column and silently override
-- that REVOKE (in PostgreSQL a table privilege satisfies the per-column check),
-- so grant UPDATE per-column on profiles EXCLUDING is_admin to mirror the
-- intended hardening — this is what makes the self-promotion deny below real.
grant update (id, email, display_name, username, public_id, bio, avatar, display_currency, created_at)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 1–15: SECURITY DEFINER helper unit tests (definer-privileged, role-agnostic).
-- ---------------------------------------------------------------------------
select is(public.is_friend('00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-00000000b0b0'), true,  'is_friend: alice & bob are mutual friends');
select is(public.is_friend('00000000-0000-0000-0000-00000000b0b0', '00000000-0000-0000-0000-00000000a11c'), true,  'is_friend: symmetric for bob & alice');
select is(public.is_friend('00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-00000000ca01'), false, 'is_friend: one-way request (carol->alice) is not friendship');
select is(public.is_friend('00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-00000000a11c'), false, 'is_friend: a user is not their own friend');

select is(public.is_visible_to('00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-00000000b0b0'), true,  'is_visible_to: friends are visible');
select is(public.is_visible_to('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000a11c'), false, 'is_visible_to: stranger is not visible');
select is(public.is_visible_to('00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-00000000a11c'), true,  'is_visible_to: a user can see themselves');

select is(public.can_view_collection('00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-0000000c0001'), true,  'can_view_collection: owner sees own private collection');
select is(public.can_view_collection('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000c0001'), false, 'can_view_collection: stranger cannot see a private collection');
select is(public.can_view_collection('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000c0002'), true,  'can_view_collection: anyone sees a public collection');
select is(public.can_view_collection('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000c0003'), true,  'can_view_collection: shared-with user sees a shared collection');
select is(public.can_view_collection('00000000-0000-0000-0000-00000000b0b0', '00000000-0000-0000-0000-0000000c0001'), true,  'can_view_collection: friend sees a private collection');

select is(public.is_admin('00000000-0000-0000-0000-0000000ad311'), true,  'is_admin: admin profile flagged');
select is(public.is_admin('00000000-0000-0000-0000-00000000a11c'), false, 'is_admin: non-admin profile not flagged');
select is(public.is_admin(null), false, 'is_admin: null uid is not admin');

-- ---------------------------------------------------------------------------
-- 16–37: RLS as carol (stranger; shared on one collection; carol->alice request).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca01","role":"authenticated"}';

select is(
  (select count(*)::int from public.collections where owner_user_id = '00000000-0000-0000-0000-00000000a11c'),
  2,
  'carol sees only alice public + shared collections (not private)'
);
select is(
  (select count(*)::int from public.items where collection_id = '00000000-0000-0000-0000-0000000c0001'),
  0,
  'carol cannot read items in alice private collection'
);
select is(
  (select count(*)::int from public.profiles),
  4,
  'any authenticated user can read the profiles directory'
);

select throws_ok(
  $$ insert into public.collections (id, owner_user_id, name) values ('00000000-0000-0000-0000-0000000cdead', '00000000-0000-0000-0000-00000000a11c', 'spoof') $$,
  '42501', null,
  'carol cannot insert a collection owned by alice'
);

savepoint sp_carol_ins_col;
select lives_ok(
  $$ insert into public.collections (id, owner_user_id, name) values ('00000000-0000-0000-0000-0000000cca01', '00000000-0000-0000-0000-00000000ca01', 'carol own') $$,
  'carol can insert her own collection'
);
rollback to savepoint sp_carol_ins_col;

with u as (update public.collections set name = 'hijacked' where id = '00000000-0000-0000-0000-0000000c0001' returning 1)
select is((select count(*)::int from u), 0, 'carol cannot update alice private collection (RLS filters the row)');
with d as (delete from public.collections where id = '00000000-0000-0000-0000-0000000c0001' returning 1)
select is((select count(*)::int from d), 0, 'carol cannot delete alice private collection (RLS filters the row)');

select throws_ok(
  $$ insert into public.items (id, collection_id, created_by_user_id, title) values ('00000000-0000-0000-0000-00000000eede', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000ca01', 'spoof item') $$,
  '42501', null,
  'carol cannot insert an item into alice collection'
);

select is(
  (select count(*)::int from public.friend_requests),
  1,
  'carol sees only friend_requests involving carol'
);
select throws_ok(
  $$ insert into public.friend_requests (from_user_id, to_user_id) values ('00000000-0000-0000-0000-00000000a11c', '00000000-0000-0000-0000-00000000ca01') $$,
  '42501', null,
  'carol cannot forge a friend_request from another user'
);

savepoint sp_carol_ins_fr;
select lives_ok(
  $$ insert into public.friend_requests (from_user_id, to_user_id) values ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000b0b0') $$,
  'carol can send her own friend_request'
);
rollback to savepoint sp_carol_ins_fr;

with d as (delete from public.friend_requests where from_user_id = '00000000-0000-0000-0000-00000000a11c' and to_user_id = '00000000-0000-0000-0000-00000000b0b0' returning 1)
select is((select count(*)::int from d), 0, 'carol cannot delete a friend_request she is not party to');

-- ---------------------------------------------------------------------------
-- 17/20/34: RLS as bob (mutual friend of alice).
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';

select is(
  (select count(*)::int from public.collections where owner_user_id = '00000000-0000-0000-0000-00000000a11c'),
  3,
  'bob (friend) sees all of alice collections incl. private'
);
select is(
  (select count(*)::int from public.items where collection_id = '00000000-0000-0000-0000-0000000c0001'),
  1,
  'bob (friend) can read items in alice private collection'
);
select is(
  (select count(*)::int from public.friend_requests),
  2,
  'bob sees both directed requests involving bob'
);

-- ---------------------------------------------------------------------------
-- 18/21/23/24/25/32/38: RLS as alice (owner).
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

select is(
  (select count(*)::int from public.collections where owner_user_id = '00000000-0000-0000-0000-00000000a11c'),
  3,
  'alice sees all of her own collections'
);
select is(
  (select count(*)::int from public.items where collection_id = '00000000-0000-0000-0000-0000000c0001'),
  1,
  'alice can read items in her own private collection'
);
with u as (update public.profiles set bio = 'tampered' where id = '00000000-0000-0000-0000-00000000b0b0' returning 1)
select is((select count(*)::int from u), 0, 'alice cannot update another user profile');
select throws_ok(
  $$ update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000a11c' $$,
  '42501', null,
  'alice cannot self-promote via the is_admin column (REVOKE UPDATE)'
);
with d as (delete from public.profiles where id = '00000000-0000-0000-0000-00000000b0b0' returning 1)
select is((select count(*)::int from d), 0, 'alice cannot delete another user profile');

savepoint sp_alice_ins_item;
select lives_ok(
  $$ insert into public.items (id, collection_id, created_by_user_id, title) values ('00000000-0000-0000-0000-00000000eea1', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000a11c', 'alice item') $$,
  'alice can insert an item into her own collection'
);
rollback to savepoint sp_alice_ins_item;

savepoint sp_alice_del_fr;
with d as (delete from public.friend_requests where from_user_id = '00000000-0000-0000-0000-00000000a11c' and to_user_id = '00000000-0000-0000-0000-00000000b0b0' returning 1)
select is((select count(*)::int from d), 1, 'a party (sender) can delete their own friend_request');
rollback to savepoint sp_alice_del_fr;

-- ---------------------------------------------------------------------------
-- 26: RLS as admin (profiles.is_admin = true) — may delete any profile.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000ad311","role":"authenticated"}';

savepoint sp_admin_del;
with d as (delete from public.profiles where id = '00000000-0000-0000-0000-00000000a11c' returning 1)
select is((select count(*)::int from d), 1, 'admin can delete another user profile');
rollback to savepoint sp_admin_del;

reset role;
reset request.jwt.claims;

select * from finish();

rollback;
