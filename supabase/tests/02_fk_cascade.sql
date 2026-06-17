-- BE-36 — executable pgTAP coverage for the foreign-key + ON DELETE behaviour
-- of every table that references auth.users (the BE-6 FKs), plus the
-- collection→items cascade. This is the executable half of BE-25: it proves a
-- deleted auth.users row (the `delete-account` Edge Function's terminal step)
-- cascades through every owned table and SET-NULLs the audit/analytics tables
-- that must survive a deleted account with their PII scrubbed.
--
-- `supabase test db` runs this against the local scratch database that
-- `supabase db start` built by replaying supabase/migrations/* from empty
-- (Docker runner only — this file is NOT exercised by the offline JS suite;
-- `__tests__/fk-cascade-pgtap.test.ts` covers the structural/file-scan half).
--
-- FK enforcement and ON DELETE actions apply regardless of RLS, so this test
-- runs as the privileged session role (no `set role` / jwt-claim switching) —
-- it exercises referential integrity, not row visibility (01_core_tables_rls
-- covers RLS).
--
-- Expected ON DELETE behaviour, by reference (see the migrations):
--   auth.users delete CASCADEs:  profiles.id, collections.owner_user_id,
--     items.created_by_user_id, friend_requests.from/to_user_id,
--     chat_messages.from/to_user_id, chat_reads.user_id,
--     marketplace_listings.owner_user_id
--   auth.users delete SET NULLs: marketplace_listings.buyer_user_id,
--     marketplace_transfers.owner/buyer_user_id, analytics_events.user_id
--   collections delete CASCADEs:  items.collection_id

begin;

select plan(22);

-- ---------------------------------------------------------------------------
-- Seed. `dave` is the account we will delete; `erin` is a second user kept
-- alive so the SET-NULL / cross-party rows have a surviving counterparty.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000da7e', 'dave@test.dev'),
  ('00000000-0000-0000-0000-0000000e7141', 'erin@test.dev');

insert into public.profiles (id, email, username, public_id) values
  ('00000000-0000-0000-0000-00000000da7e', 'dave@test.dev', 'dave', 'dave'),
  ('00000000-0000-0000-0000-0000000e7141', 'erin@test.dev', 'erin', 'erin');

insert into public.collections (id, owner_user_id, name) values
  ('00000000-0000-0000-0000-0000000c0da7', '00000000-0000-0000-0000-00000000da7e', 'dave col'),
  ('00000000-0000-0000-0000-0000000c07e7', '00000000-0000-0000-0000-0000000e7141', 'temp col');

insert into public.items (id, collection_id, created_by_user_id, title) values
  ('00000000-0000-0000-0000-00000000da01', '00000000-0000-0000-0000-0000000c0da7', '00000000-0000-0000-0000-00000000da7e', 'dave item'),
  ('00000000-0000-0000-0000-00000000da02', '00000000-0000-0000-0000-0000000c0da7', '00000000-0000-0000-0000-00000000da7e', 'dave item 2'),
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000c07e7', '00000000-0000-0000-0000-0000000e7141', 'temp item');

insert into public.friend_requests (from_user_id, to_user_id) values
  ('00000000-0000-0000-0000-00000000da7e', '00000000-0000-0000-0000-0000000e7141'),
  ('00000000-0000-0000-0000-0000000e7141', '00000000-0000-0000-0000-00000000da7e');

-- chat_id must satisfy chat_messages_chat_id_matches_participants:
-- 'chat-' || least(a,b) || '-' || greatest(a,b) (C-collation text sort).
-- dave (…da7e) sorts before erin (…e7141), so dave is `least`.
insert into public.chat_messages (chat_id, from_user_id, to_user_id, text) values
  ('chat-00000000-0000-0000-0000-00000000da7e-00000000-0000-0000-0000-0000000e7141', '00000000-0000-0000-0000-00000000da7e', '00000000-0000-0000-0000-0000000e7141', 'hi erin'),
  ('chat-00000000-0000-0000-0000-00000000da7e-00000000-0000-0000-0000-0000000e7141', '00000000-0000-0000-0000-0000000e7141', '00000000-0000-0000-0000-00000000da7e', 'hi dave');

insert into public.chat_reads (user_id, chat_id) values
  ('00000000-0000-0000-0000-00000000da7e', 'chat-00000000-0000-0000-0000-00000000da7e-00000000-0000-0000-0000-0000000e7141'),
  ('00000000-0000-0000-0000-0000000e7141', 'chat-00000000-0000-0000-0000-00000000da7e-00000000-0000-0000-0000-0000000e7141');

-- Listing dave owns (CASCADE on delete) + listing erin owns that dave bought
-- (buyer_user_id SET NULL on delete, row survives).
insert into public.marketplace_listings (id, item_id, owner_user_id, mode, buyer_user_id, sold_at) values
  ('listing-dave', 'item-dave', '00000000-0000-0000-0000-00000000da7e', 'sell', null, null),
  ('listing-erin', 'item-erin', '00000000-0000-0000-0000-0000000e7141', 'sell', '00000000-0000-0000-0000-00000000da7e', now());

-- Audit rows that must survive a deleted account with PII SET NULL.
insert into public.marketplace_transfers (listing_id, item_id, owner_user_id, buyer_user_id, mode) values
  ('listing-erin', 'item-erin', '00000000-0000-0000-0000-0000000e7141', '00000000-0000-0000-0000-00000000da7e', 'sell'),
  ('listing-dave', 'item-dave', '00000000-0000-0000-0000-00000000da7e', '00000000-0000-0000-0000-0000000e7141', 'sell');

insert into public.analytics_events (user_id, name) values
  ('00000000-0000-0000-0000-00000000da7e', 'app_open');

-- ---------------------------------------------------------------------------
-- 1–5: orphan inserts are rejected (23503 = foreign_key_violation).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.profiles (id, email, username, public_id) values ('00000000-0000-0000-0000-0000000ff001', 'ghost@test.dev', 'ghost', 'ghost') $$,
  '23503', null,
  'profiles.id must reference an existing auth.users row'
);
select throws_ok(
  $$ insert into public.collections (id, owner_user_id, name) values ('00000000-0000-0000-0000-0000000ff002', '00000000-0000-0000-0000-0000000ff0ff', 'orphan') $$,
  '23503', null,
  'collections.owner_user_id must reference an existing auth.users row'
);
select throws_ok(
  $$ insert into public.items (id, collection_id, created_by_user_id, title) values ('00000000-0000-0000-0000-0000000ff003', '00000000-0000-0000-0000-0000000ff0ff', '00000000-0000-0000-0000-00000000da7e', 'orphan') $$,
  '23503', null,
  'items.collection_id must reference an existing collection'
);
select throws_ok(
  $$ insert into public.items (id, collection_id, created_by_user_id, title) values ('00000000-0000-0000-0000-0000000ff004', '00000000-0000-0000-0000-0000000c0da7', '00000000-0000-0000-0000-0000000ff0ff', 'orphan') $$,
  '23503', null,
  'items.created_by_user_id must reference an existing auth.users row'
);
select throws_ok(
  $$ insert into public.friend_requests (from_user_id, to_user_id) values ('00000000-0000-0000-0000-0000000ff0ff', '00000000-0000-0000-0000-00000000da7e') $$,
  '23503', null,
  'friend_requests.from_user_id must reference an existing auth.users row'
);

-- ---------------------------------------------------------------------------
-- 6–7: deleting a collection cascades to its items.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.items where collection_id = '00000000-0000-0000-0000-0000000c07e7'),
  1,
  'temp collection has its item before delete'
);
savepoint sp_col_cascade;
delete from public.collections where id = '00000000-0000-0000-0000-0000000c07e7';
select is(
  (select count(*)::int from public.items where collection_id = '00000000-0000-0000-0000-0000000c07e7'),
  0,
  'deleting a collection cascades to its items'
);
rollback to savepoint sp_col_cascade;

-- ---------------------------------------------------------------------------
-- 8–11: fixture sanity before the account delete (proves the cascades below
-- are real removals, not rows that were never seeded).
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000da7e'), 1, 'dave profile seeded');
select is((select count(*)::int from public.collections where owner_user_id = '00000000-0000-0000-0000-00000000da7e'), 1, 'dave collection seeded');
select is((select count(*)::int from public.items where created_by_user_id = '00000000-0000-0000-0000-00000000da7e'), 2, 'dave items seeded');
select is((select count(*)::int from public.chat_messages where from_user_id = '00000000-0000-0000-0000-00000000da7e' or to_user_id = '00000000-0000-0000-0000-00000000da7e'), 2, 'dave chat messages seeded');

-- ---------------------------------------------------------------------------
-- Delete the account (mirrors delete-account's auth.admin.deleteUser).
-- ---------------------------------------------------------------------------
delete from auth.users where id = '00000000-0000-0000-0000-00000000da7e';

-- ---------------------------------------------------------------------------
-- 12–18: every owned table CASCADE-deletes dave's rows.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000da7e'), 0, 'deleting the user cascades to profiles');
select is((select count(*)::int from public.collections where owner_user_id = '00000000-0000-0000-0000-00000000da7e'), 0, 'deleting the user cascades to collections');
select is((select count(*)::int from public.items where created_by_user_id = '00000000-0000-0000-0000-00000000da7e'), 0, 'deleting the user cascades to items');
select is((select count(*)::int from public.friend_requests where from_user_id = '00000000-0000-0000-0000-00000000da7e' or to_user_id = '00000000-0000-0000-0000-00000000da7e'), 0, 'deleting the user cascades to friend_requests (both directions)');
select is((select count(*)::int from public.chat_messages where from_user_id = '00000000-0000-0000-0000-00000000da7e' or to_user_id = '00000000-0000-0000-0000-00000000da7e'), 0, 'deleting the user cascades to chat_messages (sent + received)');
select is((select count(*)::int from public.chat_reads where user_id = '00000000-0000-0000-0000-00000000da7e'), 0, 'deleting the user cascades to chat_reads');
select is((select count(*)::int from public.marketplace_listings where owner_user_id = '00000000-0000-0000-0000-00000000da7e'), 0, 'deleting the user cascades to owned marketplace_listings');

-- ---------------------------------------------------------------------------
-- 19–22: audit/analytics rows SURVIVE with the deleted user's id SET NULL.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.marketplace_listings where id = 'listing-erin' and buyer_user_id is null),
  1,
  'a bought listing survives the buyer account delete with buyer_user_id SET NULL'
);
select is(
  (select count(*)::int from public.marketplace_transfers where listing_id = 'listing-erin' and buyer_user_id is null),
  1,
  'a transfer survives the buyer account delete with buyer_user_id SET NULL'
);
select is(
  (select count(*)::int from public.marketplace_transfers where listing_id = 'listing-dave' and owner_user_id is null),
  1,
  'a transfer survives the seller account delete with owner_user_id SET NULL'
);
select is(
  (select count(*)::int from public.analytics_events where name = 'app_open' and user_id is null),
  1,
  'an analytics event survives the account delete with user_id SET NULL'
);

select * from finish();

rollback;
