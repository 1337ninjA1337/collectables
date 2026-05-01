-- Track per-user, per-chat last-read timestamps so the unread badge
-- is consistent across devices. A row exists only after the first markRead;
-- missing rows are treated as "never read" (unread count = all messages).

create table if not exists public.chat_reads (
  user_id   uuid    not null references auth.users(id) on delete cascade,
  chat_id   text    not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

alter table public.chat_reads enable row level security;

-- Users can only read and write their own rows.
create policy "chat_reads_select_own"
  on public.chat_reads for select
  using (auth.uid() = user_id);

create policy "chat_reads_upsert_own"
  on public.chat_reads for insert
  with check (auth.uid() = user_id);

create policy "chat_reads_update_own"
  on public.chat_reads for update
  using (auth.uid() = user_id);
