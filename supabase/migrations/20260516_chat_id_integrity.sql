-- chat_id integrity: the conversation key must be derivable from its two
-- participants so a buggy or crafted client cannot mis-bucket a message into
-- an arbitrary conversation.
--
-- The app builds the id with `buildChatId(a, b)` in lib/chat-helpers.ts:
--   `chat-` + min(a, b) + `-` + max(a, b)   (lexicographic / UTF-16 string sort)
--
-- The equivalent server expression sorts the two uuids as text under the
-- byte-order "C" collation, which matches JavaScript's default string sort
-- for canonical lowercase uuids (auth.users.id is always lowercase uuid::text).
--
-- Added NOT VALID so the migration never fails on a pre-existing DB that may
-- still hold legacy/forged rows: the rule is enforced for every new INSERT
-- (every legitimate client send already conforms via buildChatId), while old
-- rows are left untouched. Run `VALIDATE CONSTRAINT` manually after auditing
-- historical rows (see MANUAL-TASKS.md) to extend the guarantee backwards.

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_chat_id_matches_participants
  CHECK (
    chat_id = 'chat-'
      || least(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C")
      || '-'
      || greatest(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C")
  )
  NOT VALID;
