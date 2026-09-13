/**
 * "The entry currency may have changed" — said once, heard by every screen
 * that is reading it.
 *
 * ## The staleness this exists for
 *
 * Three surfaces read the entry slot, each with its own `useState` and its own
 * `getEntryCurrency()` effect on mount: the settings card that explains the
 * preference, and the two cost forms that open in it. A stack keeps the screen
 * underneath MOUNTED, so a collector who opens the wishlist, walks to settings,
 * changes the currency new costs are typed in and comes back finds the add
 * sheet still offering the old one. Nothing is wrong on disk; the screen simply
 * read the slot once, an hour ago.
 *
 * Before 2026-09-13 that was hard to reach, because settings could only CLEAR
 * the preference and the forms wrote it themselves. Giving the settings card a
 * picker is what made two mounted readers of one slot an ordinary Tuesday.
 *
 * ## Why a notification and not a value
 *
 * Listeners are told that the answer moved, not what it moved to, and they
 * re-read. The entry currency is not one slot: an empty entry key means
 * "follow the display currency", so `getEntryCurrency` reads through — and a
 * change to the DISPLAY currency therefore changes the effective entry currency
 * for everybody who has never chosen one. A store that published a value would
 * have to know which of the two keys it is speaking for; publishing a nudge
 * lets the one function that already knows the rule answer the question.
 *
 * ## Why not the provider
 *
 * `CollectionsProvider` owns the display currency and every total re-renders on
 * it. The entry currency re-renders no total, so putting it there would
 * re-render all of them on a change that cannot affect any — the argument the
 * settings card was written under, unchanged.
 *
 * Pure and node-safe: a `Set` of callbacks and nothing else, so a suite can
 * drive it without a tree.
 */

type EntryCurrencyListener = () => void;

const listeners = new Set<EntryCurrencyListener>();

/**
 * Registers `listener` to be called whenever the entry currency may have
 * changed, and hands back the unsubscribe.
 *
 * The unsubscribe is the whole contract: a screen that subscribes and never
 * lets go keeps its closure — and the component tree it captured — alive for
 * the life of the process, which is the failure mode `use-visibility-refresh`
 * was fixed for in an export that runs outside a browser.
 */
export function subscribeToEntryCurrency(
  listener: EntryCurrencyListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Tells every reader the entry currency may have moved.
 *
 * Iterates a COPY, because a listener is free to unsubscribe (a screen
 * unmounting on the same tick) or to subscribe from inside its own callback,
 * and mutating the set mid-iteration would silently skip the listener that
 * happened to be next.
 *
 * A listener that throws must not stop the rest being told: a screen that has
 * gone wrong is not a reason for every other screen to keep a stale currency.
 * So every listener runs, and the failures are raised together afterwards, as
 * an `AggregateError` on the caller — which is the write that just happened,
 * so the error arrives somewhere with context rather than out of a timer with
 * none. Deferring it to a later tick was the first draft and it turns a bug in
 * one screen into an uncaught exception nobody can trace back to this call.
 */
export function notifyEntryCurrencyChanged(): void {
  const failures: unknown[] = [];
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "entry-currency-store: a listener threw while being told the entry currency changed",
    );
  }
}

/** How many readers are listening — for suites, and for nothing else. */
export function entryCurrencyListenerCount(): number {
  return listeners.size;
}
