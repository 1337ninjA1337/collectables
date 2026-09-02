# CLAUDE.md

NEVER ADD a small "configured by you in this browser" badge plus a "Clear runtime credentials" button next to the new runtime Supabase config form, so a user who pasted the wrong URL/key can reset without digging into devtools `localStorage`. The clear helper (`clearRuntimeSupabaseConfig`) already exists; this is purely UI plumbing. ALWAYS USE CREDENTIALS FROM GITHUB SECRETS

- always build an app using github secrets
- push all changes ONLY into main branch.
- IN CASE THERE ARE ANY REQ CHANGES INTO DB (supabase sql commands) ADD EVERYTHING THAT I NEED TO IMPLEMENT MANUALLY IN MANUAL-TASKS.md 
- NEVER push any credentials into git (if there are any creds in commit than just replace them with *paste your creds*) 
- deploy every changes into github pages by yourself — push to main, GitHub Actions deploys with secrets automatically (DO NOT run `npx gh-pages` locally — it builds without secrets and breaks the app)
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

Tests run on the built-in `node:test` runner via `tsx`:

```bash
npm test           # typechecks first (pretest hook), then runs __tests__/*.test.ts
npm run typecheck  # tsc --noEmit on its own
npm run test:only  # same suites, skipping the typecheck (tight iteration loop)
npm run lint:all   # every pure code-style guard in lib/lint-guards.ts
npm run lint:ci    # typecheck → lint:all → test
npm run verify:dist # the four guards that read dist/ (needs a build first)
npm run verify     # lint:ci → build → verify:dist, the full gate — run THIS before committing
```

`npm run verify` is the single command to run before every commit. It chains
the NINE steps CI runs (typecheck → lint:all → test → audit baseline → build
→ bundle secrets → bundle size → bundle smoke → ships-to-client) in the same order, fail-fast, so a green
`verify` locally means a green CI. Running the legs by hand is only for
iterating on one of them — a hand-assembled sequence is exactly how a leg gets
silently skipped.

It said "the four legs" until the day the last three cost a red CI: the
post-build guards run against `dist/`, so they were left out of the gate and
out of the case that was supposed to compare the gate with ci.yml — which
compared it against a hand-written copy of the same four. `verify-gate-script.test.ts`
reads the step list out of ci.yml now, so a tenth step either joins the gate
or turns that case red — which is how `lint:ships-to-client`, the ninth, came
to be in both. The sentences ABOUT that list are checked the same way:
`gate-legs-restated.test.ts` derives the count from the script chain and reads
every document that states it, including this one.

`npm test` runs `tsc --noEmit` first because `tsx` strips types without
checking them: a type-broken test file passes the runner and fails CI. Prefer
`npm run typecheck` over `npx tsc` — npx falls back to fetching a newer
TypeScript major from the registry when `node_modules` is missing.

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
