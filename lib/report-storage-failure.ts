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
  "collections-context.getItem",
  "chat-context.getItem",
  "chat-context.setItem",
  "premium-context.getItem",
  "premium-context.setItem",
  "marketplace-context.getItem",
  "marketplace-context.setItem",
  "social-context.getItem",
  "social-context.setItem",
  "diagnostics-context.getItem",
  "diagnostics-context.setItem",
  "i18n-context.getItem",
  "i18n-context.setItem",
  "cloud-import.setItem",
  "currency-rates.setItem",
  "locale-helpers.getItem",
  "locale-helpers.setItem",
  "marketplace-transfer-log.getItem",
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
  // BEFORE the budget check: an observer's idea of repetition is its own, and a
  // read that already spent this pair's budget must not hide the first WRITE
  // from a user who is losing edits. See `observeStorageFailures`.
  notifyObservers({ scope, keyspace, reason: classifyStorageError(error) });
  if (reported.has(budget)) return false;
  reported.add(budget);
  captureException(error, { scope, extra: { keyspace } });
  return true;
}

/**
 * WHY the store said no, as far as the error can be trusted to say.
 *
 * `"full"` is the one cause with a different fix for the user: free up space.
 * Everything else — a `SecurityError` behind a privacy setting, a disabled
 * store, a `localStorage` that is not there at all — is `"unavailable"`, which
 * a restart may well clear. The distinction is the difference between telling
 * somebody to restart the app (useless on a full disk) and telling them to
 * delete something (useless when the store is blocked).
 */
export type StorageFailureReason = "full" | "unavailable";

/**
 * Reads the quota signals every engine spells differently.
 *
 * Web spells it `QuotaExceededError` (code 22) and Firefox
 * `NS_ERROR_DOM_QUOTA_REACHED` (code 1014); the React Native AsyncStorage
 * backends surface a SQLite or a `Errno 28: No space left on device` string
 * with no `name` at all, so the message is read too. Anything unrecognised is
 * `"unavailable"`: the honest default, because it is the sentence that does not
 * blame the user's photo library for a store that is merely blocked.
 */
export function classifyStorageError(error: unknown): StorageFailureReason {
  const name = typeof error === "object" && error !== null ? String((error as { name?: unknown }).name ?? "") : "";
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  const message =
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  const haystack = `${name} ${message}`.toLowerCase();
  if (code === 22 || code === 1014) return "full";
  if (haystack.includes("quota")) return "full";
  if (haystack.includes("no space left")) return "full";
  if (haystack.includes("disk is full") || haystack.includes("database or disk is full")) return "full";
  return "unavailable";
}

/** What an observer is handed. The KEYSPACE, never the key — see above. */
export type StorageFailureEvent = {
  readonly scope: StorageFailureSite;
  readonly keyspace: string;
  /** See {@link StorageFailureReason} — what to tell the user to DO about it. */
  readonly reason: StorageFailureReason;
};

export type StorageFailureObserver = (event: StorageFailureEvent) => void;

const observers = new Set<StorageFailureObserver>();

/**
 * Watch every storage failure this session reports, and return an unsubscribe.
 *
 * ## Why a registry rather than a return value
 *
 * A rejected write is the one failure mode with a user-visible consequence
 * (their edits are not being kept) and no path to the UI. Nine of the twelve
 * call sites are inside a `.catch()` in a module with no React in it —
 * `lib/tombstones.ts`, `lib/sync-cursors.ts`, `lib/currency-rates.ts` — so
 * "have the caller raise a toast" is not available at most of them, and the
 * three that could would each need the decision written out again.
 *
 * `lib/storage-notice.ts` is the only subscriber today and it filters to
 * writes; the registry itself takes no position on which failures matter. It
 * subscribes ONCE, from `components/storage-notice.tsx` — a registry that
 * reaches the whole tree needs one listener, not one per provider that happens
 * to render the same sentence.
 *
 * ## Observers fire on EVERY failure, budget or no budget
 *
 * The once-per-site/keyspace budget exists to keep a full disk from becoming a
 * stream of Sentry events. An observer has its own idea of repetition — the
 * notice raises one toast per session across all sites — and letting the Sentry
 * budget gate it would mean a read that spent the budget could hide the first
 * write from the user entirely.
 *
 * A throwing observer must not take a storage `.catch()` down with it, so each
 * one is called inside its own `try`. Its failure goes to Sentry as itself.
 */
export function observeStorageFailures(observer: StorageFailureObserver): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

/** Test seam: a suite that subscribed and threw must not leak into the next. */
export function __clearStorageFailureObserversForTests(): void {
  observers.clear();
}

/**
 * Test seam: how many observers the registry holds.
 *
 * The registry has no cap, and every subscriber works — so five providers each
 * subscribing raises exactly the same one toast as one component doing it, and
 * nothing about the extra four looks wrong from the outside. This is what lets
 * a case assert the COUNT rather than the outcome.
 */
export function __storageFailureObserverCountForTests(): number {
  return observers.size;
}

function notifyObservers(event: StorageFailureEvent): void {
  for (const observer of observers) {
    try {
      observer(event);
    } catch (error: unknown) {
      captureException(error, { scope: "report-storage-failure.observer" });
    }
  }
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
