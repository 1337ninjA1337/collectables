-- chat_messages data-integrity hardening.
--
-- The original 20260424 migration stores a free-text `chat_id` exactly as the
-- client sends it. The client derives it deterministically in
-- `lib/chat-helpers.ts::buildChatId` as:
--
--     const [a, b] = [userA, userB].sort();   // JS code-unit order
--     return `chat-${a}-${b}`;
--
-- but nothing stops a crafted client (already past the friends-only INSERT
-- gate) from writing a message into an arbitrary `chat_id` thread, or into a
-- thread between two *other* people's ids. These constraints move that
-- invariant server-side so the stored `chat_id` is always the canonical id
-- for the two participants and a row can never address the same user on both
-- sides.
--
-- `COLLATE "C"` makes Postgres compare the two uuid-as-text values in raw
-- byte order, which matches JavaScript's default `Array.prototype.sort`
-- ordering over the ASCII-only lowercase uuid strings produced by
-- `gen_random_uuid()` / `auth.users.id`. Without it the DB's default
-- (libc) collation could order the pair differently from the client and
-- reject otherwise-valid inserts.
--
-- Added NOT VALID first then VALIDATEd so the migration is safe to run
-- against a table that already holds rows.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_messages_distinct_participants'
      AND conrelid = 'public.chat_messages'::regclass
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_distinct_participants
      CHECK (from_user_id <> to_user_id) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_messages_chat_id_canonical'
      AND conrelid = 'public.chat_messages'::regclass
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_chat_id_canonical
      CHECK (
        chat_id = 'chat-' ||
          CASE
            WHEN (from_user_id::text COLLATE "C") <= (to_user_id::text COLLATE "C")
              THEN from_user_id::text || '-' || to_user_id::text
            ELSE to_user_id::text || '-' || from_user_id::text
          END
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.chat_messages
  VALIDATE CONSTRAINT chat_messages_distinct_participants;

ALTER TABLE public.chat_messages
  VALIDATE CONSTRAINT chat_messages_chat_id_canonical;
