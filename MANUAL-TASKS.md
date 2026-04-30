# Manual Tasks

## Apply chat_messages migration (if not yet applied)

If chat messages are not delivered to the second account, the
`chat_messages` table and its RLS policies may not be live in
Supabase yet. Apply the migration manually:

1. Open the Supabase project's SQL editor.
2. Run the contents of `supabase/migrations/20260424_chat_messages.sql`.
3. Verify that:
   - the table `public.chat_messages` exists,
   - RLS is enabled,
   - the policies `chat_messages_select_participants` and
     `chat_messages_insert_friends_only` exist,
   - the `supabase_realtime` publication includes `public.chat_messages`
     (the migration runs `ALTER PUBLICATION ... ADD TABLE`).

After this is applied, both clients will see each other's messages via the
realtime push, and the new `refreshChat` / `refreshAll` polling fallback in
`lib/chat-context.tsx` will reconcile any missed pushes within ~8–15s.
