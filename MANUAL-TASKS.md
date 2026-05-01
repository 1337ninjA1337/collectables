# Manual Tasks

## Add SUPABASE_DB_URL secret to GitHub repository (for automated migrations)

The deploy workflow now includes a `migrate` job that runs `supabase db push`
automatically on every push to main. To activate it:

1. Get your database connection URL from the Supabase dashboard:
   - Project Settings → Database → Connection string (URI format)
   - Use the **Transaction** or **Direct** connection string (not Pooler)
2. In GitHub: Settings → Secrets and variables → Actions → New repository secret
3. Name: `SUPABASE_DB_URL`
4. Value: your connection string (e.g. `postgresql://postgres:[password]@[host]:5432/postgres`)

Once set, every push to `main` will automatically apply any new migrations in
`supabase/migrations/` before the static site is deployed.

Without this secret, the `migrate` job is skipped and migrations must be applied
manually as described below.

## Apply chat_reads migration (cross-device unread sync)

Run `supabase/migrations/20260501_chat_reads.sql` against your Supabase project
to create the `chat_reads` table that persists per-user last-read timestamps.
Without this table the unread badge resets on each new device/browser.

```sql
-- paste the contents of supabase/migrations/20260501_chat_reads.sql
-- into the Supabase SQL editor and run it.
```

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
