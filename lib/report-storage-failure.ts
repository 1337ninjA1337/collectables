import { captureException } from "@/lib/sentry";
import { storageKeyLabel } from "@/lib/storage-keys";

/**
 * Every site that may report, as `<module basename>.<AsyncStorage method>`.
 *
 * A `string` scope was a convention held by twelve call sites and checkable
 * from nowhere: `tombstone.setItem` for `tombstones.setItem` buys a second
 * budget entry and a Sentry scope nobody groups on, with nothing anywhere
 * going red. The adoption cases that would have caught it asserted each
 * module's spelling against a list written by the same hand in the same hour,
 * which is a copy of the typo rather than a check on it.
 *
 * THE LIST IS THE SOURCE AND THE TYPE IS DERIVED, not the other way round. A
 * union written by hand would be checkable by the compiler and invisible to
 * the suite, and what the suite needs to ask is the half a type cannot answer:
 * that every entry here is actually PASSED by somebody. An entry nobody passes
 * is a site that stopped reporting, which is a hole standing open with nothing
 * about it looking stale.
 *
 * The NAME is a convention with a consequence, so it is enforced rather than
 * described: the half before the dot is the basename of the module that passes
 * it, under `lib/`. That is what lets a reader go from a Sentry scope to the
 * write in one step, and what lets the suite check the mapping without a
 * second table naming the same ten things.
 */
export const STORAGE_FAILURE_SITES = [
  "use-persisted-blob.setItem",
  "tombstones.getItem",
  "tombstones.setItem",
  "sync-cursors.getItem",
  "sync-cursors.setItem",
  "chat-context.setItem",
  "premium-context.setItem",
  "marketplace-context.setItem",
  "social-context.setItem",
  "diagnostics-context.setItem",
  "i18n-context.setItem",
  "cloud-import.setItem",
  "currency-rates.setItem",
  "locale-helpers.getItem",
  "locale-helpers.setItem",
  "marketplace-transfer-log.setItem",
] as const;

/** One of {@link STORAGE_FAILURE_SITES}. */
export type StorageFailureSite = (typeof STORAGE_FAILURE_SITES)[number];

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
export function reportStorageFailure(
  scope: StorageFailureSite,
  key: string,
  error: unknown,
): boolean {
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
