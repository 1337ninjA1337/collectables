-- chat_messages: server-of-truth storage for direct chats.
--
-- Today the app stores chats in each user's local AsyncStorage, so a message
-- never reaches the recipient. This migration introduces a Postgres-backed
-- table with row-level security so:
--   * either participant of a chat can SELECT their messages
--   * a sender may only INSERT a row whose `from_user_id` is themselves AND
--     where the recipient is a confirmed friend (mutual `friend_requests`)
--   * UPDATE / DELETE are not exposed (no policy granted) so messages are
--     immutable once stored
--
-- The realtime channel will broadcast inserts to both participants once we
-- subscribe in chat-context.tsx (see the chat-cloud-4 sub-task).

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     text          NOT NULL,
  from_user_id uuid         NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  to_user_id  uuid          NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  text        text          NOT NULL CHECK (length(text) > 0 AND length(text) <= 4000),
  created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_chat_created_idx
  ON public.chat_messages (chat_id, created_at);

CREATE INDEX IF NOT EXISTS chat_messages_recipient_created_idx
  ON public.chat_messages (to_user_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Either participant may read messages addressed to / sent by them.
CREATE POLICY "chat_messages_select_participants"
ON public.chat_messages
FOR SELECT
USING (
  auth.uid() = from_user_id
  OR auth.uid() = to_user_id
);

-- A sender may only insert their own outgoing messages, and only when both
-- directions of the friend_requests row exist (i.e. mutual friendship). This
-- enforces the "friends only" rule on the server so a crafted client cannot
-- bypass the UI gate.
CREATE POLICY "chat_messages_insert_friends_only"
ON public.chat_messages
FOR INSERT
WITH CHECK (
  auth.uid() = from_user_id
  AND from_user_id <> to_user_id
  AND EXISTS (
    SELECT 1
    FROM public.friend_requests fr
    WHERE fr.from_user_id = auth.uid()
      AND fr.to_user_id = chat_messages.to_user_id
  )
  AND EXISTS (
    SELECT 1
    FROM public.friend_requests fr
    WHERE fr.from_user_id = chat_messages.to_user_id
      AND fr.to_user_id = auth.uid()
  )
);

-- Expose the table on Supabase realtime so subscribed clients receive new rows.
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
