# Photo storage decision (BE-24)

This is the written decision record behind **BE-24**: do we keep Cloudinary
(hardened with a signed upload path) or migrate photo storage to **Supabase
Storage** buckets with RLS mirroring the collection/item visibility rules?
It also records the **retention / orphan-cleanup story** — i.e. what is
supposed to happen to an asset when the item, collection, or account that owns
it is deleted.

## Decision

**We keep Cloudinary** and harden it by moving the upload off the abusable
unsigned `upload_preset` and onto a **signed upload Edge Function**, mirroring
the deletion path that already exists.

This is **option (a)** from the BE-24 suggestion. Option (b) — migrating to
Supabase Storage buckets — was rejected for now (see comparison below).

### Why option (a)

- The deletion half of the secure design **already shipped** (SEC-1): the
  Cloudinary API secret lives only in Supabase function secrets and the
  `delete-image` Edge Function (`supabase/functions/delete-image/index.ts`)
  verifies the caller's Supabase session and computes the destroy signature
  server-side. The client only ever sends public IDs + its own JWT. Keeping
  Cloudinary lets the upload path reuse that exact pattern.
- Cloudinary's on-the-fly transformation/derivation URLs
  (`lib/cloudinary-url.ts`) are already wired through every image-rendering
  surface. Supabase Storage has no equivalent built-in transformation tier on
  the free plan, so migrating would also mean re-solving thumbnailing.
- It is the **smaller, lower-risk** change: one new Edge Function + one client
  swap, with the rest of the asset pipeline untouched.

### What the residual abuse surface is (and the fix)

Today uploads still go through the **unsigned** preset in `lib/cloudinary.ts`
(`form.append("upload_preset", cloudinaryConfig.uploadPreset)`), which means
anyone who reads the bundle can push arbitrary images into the account's
Cloudinary quota. The hardening (tracked as the BE-24 follow-up implementation
task, separate from this decision) is:

1. Add a `sign-upload` Edge Function that verifies the caller's Supabase
   session and returns a short-lived Cloudinary upload signature
   (`timestamp` + `signature` computed from `CLOUDINARY_API_SECRET`, which
   stays in Supabase function secrets and **never** becomes an
   `EXPO_PUBLIC_*` var — Metro inlines those into the bundle).
2. Switch `uploadImage` to request that signature, then POST the signed
   `timestamp`/`signature`/`api_key` instead of `upload_preset`.
3. Disable the unsigned preset in the Cloudinary dashboard once the signed
   path is live (recorded in `MANUAL-TASKS.md`).

## Comparison

| Concern | (a) Cloudinary + signed upload **(chosen)** | (b) Supabase Storage + RLS |
| --- | --- | --- |
| Effort | Low — reuse the `delete-image` signature pattern | High — buckets, RLS, migration of existing URLs, re-do transforms |
| Sub-processors | Keeps Cloudinary as a third-party sub-processor | Removes Cloudinary; consolidates onto Supabase |
| Transformations | Built-in (`lib/cloudinary-url.ts` already wired) | Must re-implement thumbnail/derivation tier |
| Access control | Public assets; obscured public IDs | RLS can mirror collection/item visibility natively |
| Abuse surface | Closed by the signed-upload follow-up | Closed by RLS insert policies |
| Migration cost | None (URLs unchanged) | Must rewrite every stored `secure_url` |

**Revisit trigger:** if private collections ever need true asset-level access
control (i.e. a non-follower must not be able to fetch a private item's photo
even with the URL), Cloudinary public delivery is insufficient and option (b)'s
RLS-gated storage becomes the right call. Re-open BE-24 at that point.

## Retention / orphan-cleanup story

The BE-24 requirement is explicit: **deleting an item must delete its asset.**
Here is the current state and the gap.

### What works today

- **Account deletion** cleans up assets. `deleteAccount` in
  `lib/auth-context.tsx` calls `fetchAllUserImageUrls(userId)` then
  `deleteCloudinaryImages(...)` (which routes through the signed
  `delete-image` Edge Function) **before** tearing down the account. So no
  asset is orphaned by an account deletion.

### The gap (orphans)

- **Item and collection deletion do NOT delete their Cloudinary assets.**
  `deleteItem` / `deleteItems` / `deleteCollection` in
  `lib/collections-context.tsx` only soft-delete the rows (tombstones for
  sync) — they never call `deleteCloudinaryImages`. So every photo on a
  deleted item/collection becomes an **orphan** in Cloudinary until the whole
  account is deleted.
- This is a **cost/quota leak, not a data-loss or privacy bug** — the orphan is
  unreferenced and best-effort deletion already tolerates failure
  (`deleteCloudinaryImages` swallows errors by design, per its comment).

### Cleanup plan (the orphan story)

1. **On hard delete:** wire `deleteItem` / `deleteItems` / `deleteCollection`
   to collect the deleted rows' image URLs and call `deleteCloudinaryImages`
   best-effort. Soft delete (tombstone) intentionally stays asset-preserving
   because a tombstoned row can still be undeleted by a delta pull; only a
   genuine hard purge should drop the asset.
2. **Sweep for stragglers:** a periodic reconciliation (`pg_cron`, tracked as
   BE-27 retention sweeps) lists Cloudinary public IDs with no referencing
   row and destroys them, catching anything a best-effort delete missed
   (offline-at-delete, function error, etc.).
3. **Soft-delete grace window:** an asset for a soft-deleted row is purged only
   after the tombstone retention window passes (so an undelete within the
   window still has its photo), consistent with the tombstone policy in
   `docs/CONFLICT-POLICY.md`.

The reconciliation sweep is the durable backstop: best-effort inline deletion
keeps the common case clean, and the sweep guarantees eventual consistency
between the asset store and the row store regardless of which storage backend
wins a future BE-24 revisit.
