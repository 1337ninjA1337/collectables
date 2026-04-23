# CLAUDE.md

- deploy every changes into github pages by yourself
- don't explain enything except when i ask to explain
- allow all the edits 
- after each change push those changes into git (main branch) with minimized commit name (just task name)
- affter changes were pushed into git remore task that were made from .tasks

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

NEVER RUN "npm run start", "npm run web", "npm run ios", "npm run android", USE "npm run build" to check if code compiles or not instead. See results and fix code it it's needed

## Commands

```bash
# Start dev server (choose platform)
npm start          # interactive menu
npm run android    # Android emulator
npm run ios        # iOS simulator
npm run web        # browser

# Lint
npm run lint       # expo lint (ESLint under the hood)
```

There is no test suite. TypeScript type-checking is done via `tsc --noEmit` (use `npx tsc --noEmit` to check types manually).

## Environment

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Without these, the app still runs — auth is disabled and the UI shows a "configure Supabase" message. The `isSupabaseConfigured` flag in `lib/supabase.ts` gates all auth calls.

## Architecture

### Data layer — AsyncStorage only, no backend queries

All app data is stored locally via `@react-native-async-storage/async-storage`. There is no API layer beyond Supabase Auth. On first load, if nothing is in storage, the contexts fall back to seed data from `data/seed.ts` (own collections/items) and `data/social-seed.ts` (other users' profiles, collections, items).

**Storage keys:**
- `collectables-collections-v1` — user's own collections
- `collectables-items-v1` — user's own items
- `collectables-social-v1-{userId}` — following list + profile override
- `collectables-social-graph-v1` — friend requests + deleted profile IDs
- `collectables-language-v1` — selected language code

### Context hierarchy

Provider nesting in `app/_layout.tsx` (order matters):
```
I18nProvider → AuthProvider → SocialProvider → CollectionsProvider
```

- **`lib/i18n-context.tsx`** — translations (`t()`) and language selection. Supports `ru`, `en`, `be`, `pl`, `de`, `es`; defaults to `"ru"`. All UI strings must go through `t()`.
- **`lib/auth-context.tsx`** — Supabase session, email OTP flow, OAuth (Google/Apple). Exposes `session`, `user`, `pending`, and auth methods.
- **`lib/social-context.tsx`** — Profiles, friend requests (mutual = friends), follow list, admin flag, visibility of social collections/items. Social collections/items come only from `seedSocialCollections`/`seedSocialItems`; visibility is gated by following/friends.
- **`lib/collections-context.tsx`** — Merges the user's local collections+items with those visible via social context. Writes back to AsyncStorage on every change.

### Routing (expo-router file-based)

```
app/_layout.tsx          — root layout, auth gate, provider tree
app/index.tsx            — home screen
app/create.tsx           — add item form
app/create-collection.tsx — new collection form
app/collection/[id].tsx  — collection detail
app/item/[id].tsx        — item detail
app/people.tsx           — people/following browser
app/profile/[id].tsx     — user profile view
app/auth/callback.tsx    — OAuth redirect handler
```

### Key types (`lib/types.ts`)

- `Collection` — owns `role: "owner" | "viewer"` to distinguish owned vs. shared-with-me collections
- `CollectableItem` — belongs to a collection via `collectionId`
- `UserProfile` — has both `id` (auth UUID) and `publicId` (slug, user-facing), plus `username`
- `ProfileRelationship` — `"self" | "friend" | "following" | "request_sent" | "request_received" | "none"`

### Admin

Admin is determined at runtime in `SocialProvider`: a user is admin if their `username === "1337antoxa"` or `email === "1337.antoxa@gmail.com"`. Admins can delete other profiles.

### Styling

All styles are co-located with their component using `StyleSheet.create`. The design uses a warm brown palette: dark `#261b14`, light `#fff7ef`/`#fffaf4`, and amber accent `#d89c5b`. No shared style utilities exist — add new styles inline in the relevant file.
