-- Chat DB #1 — Idempotent message sends.
--
-- The current `public.chat_messages` table stores a server-issued `id`. When a
-- client retries a send (transient network failure, app backgrounded mid-flush
-- of the pending-queue, slow ack), the second POST happily inserts a *second*
-- row with a fresh server uuid — duplicating the same logical message in the
-- chat thread.
--
-- Fix: clients generate a uuid v4 (`client_message_id`) and attach it to every
-- INSERT. A partial UNIQUE index on `(from_user_id, client_message_id)` makes
-- the second insert fail with 23505 (conflict), letting the client treat the
-- retry as "already stored — refetch and dedupe" instead of producing a dup.
--
-- The column is nullable so existing rows back-compat without a backfill, and
-- the unique index is partial so legacy NULL rows do not collide.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS client_message_id uuid;

-- Partial unique index: each (sender, client_message_id) pair is unique when
-- the client supplied an id. Legacy rows with NULL client_message_id are
-- ignored by this index.
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_id_uniq
  ON public.chat_messages (from_user_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
