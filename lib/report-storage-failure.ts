import { captureException } from "@/lib/sentry";
import { storageKeyLabel } from "@/lib/storage-keys";

/**
 * One statement of "a storage read/write failed, and somebody should know".
 *
 * ## Why this is a module rather than four copies
 *
 * `usePersistedBlob` learned to report a rejected `setItem` because silent
 * local data loss is the worst thing it can do. The writes that were left
 * silent are the ones whose failure is not merely lost data but a CORRUPTED
 * SYNC, and they live in `lib/tombstones.ts` and `lib/sync-cursors.ts`:
 *
 *   - an unreadable tombstone store makes the delta pull hold its cursor, so
 *     the same window re-pulls on every refresh, forever, with nothing
 *     counting the retries;
 *   - a failed tombstone write is the same hold, for the same reason;
 *   - a failed cursor write silently converts every later delta pull into a
 *     wider one, which is the egress the delta path exists to save.
 *
 * Each of those is four lines beside the write. Written four times they become
 * four session budgets that a full device store spends independently, and four
 * places to look when the rule changes.
 *
 * ## The budget is SHARED, and keyed by site AND keyspace
 *
 * Shared, because a full store is ONE fact about the device and the number of
 * modules that noticed it is not information. A per-module `Set` would let the
 * same disk report once per module — which is exactly the "one full disk
 * becomes a stream" outcome the budget exists to prevent, arrived at by
 * addition instead of repetition.
 *
 * Keyed by the SITE as well as the keyspace, because "the tombstone store
 * could not be read" and "the tombstone store could not be written" are
 * different diagnoses with different fixes, and collapsing them would let
 * whichever happened first hide the other for the rest of the session. The
 * product is small and fixed — a handful of call sites over a handful of
 * keyspaces — so it is a bound, not a stream. A caller that passes a scope
 * built from a value (rather than a literal naming the site) would turn it
 * into one; every caller in this tree passes a literal.
 *
 * The KEYSPACE, never the key. Every per-user builder in `lib/storage-keys.ts`
 * ends in the account's Supabase auth id, and `scrubPII` reads event bodies,
 * not the `extra` a caller assembles — so a raw key here is an identifier
 * nobody decided to send. `storageKeyLabel` takes it out and keeps the part
 * that says WHICH store broke.
 *
 * Returns whether this call reported, so a caller can assert the budget rather
 * than infer it. Nothing is required to read it.
 */
export function reportStorageFailure(scope: string, key: string, error: unknown): boolean {
  const keyspace = storageKeyLabel(key);
  // NUL rather than ":" — a scope or a keyspace may contain punctuation, and a
  // separator that either half can contain lets two different pairs collide on
  // one budget entry, which silently drops the second one's report.
  const budget = `${scope}\u0000${keyspace}`;
  if (reported.has(budget)) return false;
  reported.add(budget);
  captureException(error, { scope, extra: { keyspace } });
  return true;
}

/**
 * Site/keyspace pairs already reported this session.
 *
 * Per session rather than per mount: a provider that remounts on every
 * navigation must not turn one full disk into a stream. Sentry's own limiter
 * would eventually cap the volume; this decides WHICH events survive instead
 * of letting the first minute of a full disk spend the budget.
 */
const reported = new Set<string>();

/** Module scope survives between suites in one process; a seeding suite resets. */
export function __resetStorageFailureReportsForTests(): void {
  reported.clear();
}
