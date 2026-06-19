# Sync conflict policy

This documents how the app resolves conflicts when the same entity is changed
on more than one device (or offline then reconnected), and how deletions
propagate. It is the written contract behind the BE-9 / BE-14 / BE-15 sync work.

## Last-Write-Wins by `updated_at`

The conflict policy is **Last-Write-Wins (LWW) keyed on `updated_at`**.

- Every synced table carries an `updated_at timestamptz NOT NULL DEFAULT now()`
  plus a `BEFORE UPDATE` `moddatetime` trigger that bumps it on **every**
  mutation — including the `DO UPDATE` branch of the app's PostgREST upserts
  (migration `20260621_updated_at_moddatetime.sql`, BE-9). The client never
  sends `updated_at`; the database owns it.
- Writes are idempotent upserts (`ON CONFLICT (id) DO UPDATE`). The server-side
  row keyed by `id` is the single source of truth; the most recent write wins
  because it overwrites the row and stamps the latest `updated_at`.
- Reads are **delta pulls**: the client stores the highest `updated_at` it has
  seen per entity/user (`lib/sync-cursors.ts`, BE-14) and asks PostgREST for
  `updated_at=gt.<cursor>`, so only rows changed since the last sync return.
  An incoming row with a newer `updated_at` replaces the local copy.

There is intentionally **no field-level merge** and no vector clock. The unit
of conflict resolution is the whole row, and "last" means "highest server
`updated_at`". This is simple, deterministic, and matches the app's data shape
(small documents a single owner edits) — the rare cost is that two near-
simultaneous edits to different fields of the same row collapse to whichever
upsert the server applied last, rather than merging.

Offline writes don't break LWW: they queue locally
(`lib/pending-upserts.ts` / `lib/pending-social.ts`, BE-13) and flush as upserts
on reconnect, at which point they take the latest `updated_at` and win against
anything older — but lose to a newer edit made elsewhere in the meantime.

## Soft delete + tombstones

A hard `DELETE` is **invisible to a delta pull** — the row simply stops being
returned, so a peer that hasn't synced since the deletion can never learn the
row is gone and its seed/cached copy resurrects. So deletes are **soft**:

- Deletable tables (`collections`, `items`, `profiles`, `friend_requests`)
  carry a nullable `deleted_at timestamptz` (migration
  `20260623_soft_delete_deleted_at.sql`, BE-15a). `NULL` = alive; a non-null
  timestamp = tombstoned.
- A delete is an UPDATE that sets `deleted_at = now()`. The BE-9 moddatetime
  trigger bumps `updated_at` on that same UPDATE, so the tombstone rides the
  ordinary `updated_at=gt.<cursor>` delta pull to every peer.
- On the client, a delta batch is split into still-alive rows vs tombstoned ids
  (`partitionByTombstone` in `lib/tombstones.ts`). Tombstoned ids are removed
  from the local cache **and** accumulated into a persisted per-entity
  tombstone set (`tombstoneKey(entity, userId)`), so a later full or seed load
  can't resurrect a remotely deleted entity.

This **generalises the social graph's existing `deletedProfileIds` set**
(`lib/social-context.tsx`): that already keeps a local list of deleted profile
ids and filters them out of every derived view. `lib/tombstones.ts` lifts the
same idea into a reusable, entity-agnostic helper driven by the cloud
`deleted_at` column.

A future retention sweep (BE-27) can hard-purge rows whose `deleted_at` is
older than the retention window, scanning the inverse of the partial
`<table>_alive_idx (deleted_at) WHERE deleted_at IS NULL` index.
