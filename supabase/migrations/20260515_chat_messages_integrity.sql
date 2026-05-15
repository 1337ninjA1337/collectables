-- chat_messages data-integrity hardening.
--
-- The conversation grouping key (`chat_id`) is derived deterministically on
-- the client: `lib/chat-helpers.ts` `buildChatId(a, b)` returns
-- `"chat-" + [a, b].sort().join("-")`. Until now that contract was enforced
-- ONLY in app code. RLS (20260424_chat_messages.sql) gates *who* may insert a
-- row (sender == auth.uid(), mutual friendship) but never constrains the
-- `chat_id` *value*. A buggy or crafted client could therefore INSERT a
-- message whose `chat_id` does not match its `(from_user_id, to_user_id)`
-- pair, which:
--   * makes the message invisible to the recipient — their client queries
--     `chat_id = eq.buildChatId(me, sender)`, so a mismatched row is never
--     fetched (a silently lost message), and
--   * lets a sender write rows into an unrelated conversation's id namespace.
--
-- Best practice for chat storage is to enforce the conversation-key invariant
-- in the database so it holds for every write path — including `service_role`
-- inserts that bypass RLS entirely. This migration adds two CHECK constraints:
--
--   * chat_messages_self_chat_chk        -- from_user_id <> to_user_id
--       (previously only in the INSERT RLS policy, so a service_role write
--        could create a self-chat row)
--   * chat_messages_chat_id_canonical_chk -- chat_id equals the canonical
--       deterministic pair key. `least`/`greatest` operate on the `uuid` type
--       (binary order), which for canonical lowercase UUID text matches the
--       JavaScript `Array.prototype.sort()` order used by `buildChatId`, so a
--       conforming client is never rejected.
--
-- Constraints are added NOT VALID then VALIDATE'd separately to keep the
-- write-lock window short, and the whole migration is wrapped in existence
-- guards so it is idempotent (safe to re-run / re-push).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_self_chat_chk'
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_self_chat_chk
      CHECK (from_user_id <> to_user_id) NOT VALID;
    ALTER TABLE public.chat_messages
      VALIDATE CONSTRAINT chat_messages_self_chat_chk;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_chat_id_canonical_chk'
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_chat_id_canonical_chk
      CHECK (
        chat_id = 'chat-'
          || least(from_user_id, to_user_id)::text
          || '-'
          || greatest(from_user_id, to_user_id)::text
      ) NOT VALID;
    ALTER TABLE public.chat_messages
      VALIDATE CONSTRAINT chat_messages_chat_id_canonical_chk;
  END IF;
END
$$;
