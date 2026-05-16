-- chat_messages integrity hardening.
--
-- 20260424_chat_messages.sql stores messages with RLS enforcing the
-- friends-only / sender-is-self rules, but `chat_id` was an unvalidated free
-- `text` column. A crafted client that passes the RLS friend gate could still
-- POST a row with a forged `chat_id`, poisoning the recipient's conversation
-- (the recipient loads a thread by `chat_id`, and the realtime inbox filters
-- only by `to_user_id`). This migration pins `chat_id` to the canonical
-- deterministic id both clients derive from the two participant uuids — it
-- mirrors lib/chat-helpers.ts:buildChatId (the two ids sorted ascending and
-- dash-joined). `COLLATE "C"` makes Postgres' least()/greatest() order bytes
-- exactly the way JavaScript's default Array.prototype.sort() does, so the
-- server-computed id matches the client-computed one for the lowercase-hex
-- uuid strings involved. It also bounds the length belt-and-braces.
--
-- A composite (chat_id, created_at, id) index backs the app's stable
-- (created_at, id) message ordering so paged thread reads stay index-only.
--
-- The CHECK is added NOT VALID so it enforces every new/updated row without a
-- blocking full-table scan and without failing the migration if a legacy row
-- predates the rule. See MANUAL-TASKS.md for the optional VALIDATE + cleanup.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_messages_chat_id_canonical_chk'
      AND conrelid = 'public.chat_messages'::regclass
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_chat_id_canonical_chk
      CHECK (
        length(chat_id) > 0
        AND length(chat_id) <= 200
        AND chat_id COLLATE "C" = (
          'chat-'
          || least(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C")
          || '-'
          || greatest(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C")
        )
      )
      NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS chat_messages_chat_created_id_idx
  ON public.chat_messages (chat_id, created_at, id);
