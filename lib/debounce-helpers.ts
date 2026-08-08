/**
 * Pure half of `lib/use-debounced-value.ts`.
 *
 * Lives in its own module for the same reason `lib/share-link-helpers.ts`
 * does: the hook file imports `react`, so it cannot be loaded under the plain
 * `tsx --test` harness. Everything here is a total function over plain values
 * and is exercised directly by `__tests__/use-debounced-value.test.ts`.
 */

/**
 * Default trailing-edge delay. 150ms is the standard "feels instant but
 * doesn't thrash" figure for keystroke-driven local work (re-running a
 * filter/matcher over an in-memory list); it is below the ~200ms threshold
 * where typing starts to feel laggy, and above a fast typist's inter-key
 * interval so a burst collapses into one settle.
 */
export const DEFAULT_DEBOUNCE_MS = 150;

/**
 * Delay for the profile search that hits Supabase (`searchProfiles`).
 * Deliberately longer than `DEFAULT_DEBOUNCE_MS`: each settle is a network
 * round trip against the whole `profiles` table, not a local array pass, so
 * the cost of firing early is a wasted request rather than a wasted render.
 * Both remote-search call sites (`app/people.tsx`,
 * `components/search-overlay.tsx`) share this constant so they can never
 * drift apart the way their two hand-rolled 300ms timers could.
 */
export const PROFILE_SEARCH_DEBOUNCE_MS = 300;

/**
 * Clamps a caller-supplied delay to a usable non-negative integer.
 *
 * `undefined`, `NaN`, `Infinity` and negatives all fall back to
 * `DEFAULT_DEBOUNCE_MS` — a nonsense delay must not be able to stall the
 * settle forever (`Infinity`) or fire it before the value is read (`-1`).
 * `0` is a legitimate caller choice (settle synchronously) and is preserved.
 */
export function resolveDebounceDelay(delayMs?: number): number {
  if (delayMs === undefined) return DEFAULT_DEBOUNCE_MS;
  if (!Number.isFinite(delayMs) || delayMs < 0) return DEFAULT_DEBOUNCE_MS;
  const floored = Math.floor(delayMs);
  // `Math.floor(-0)` is `-0`, which survives `=== 0` but not `Object.is`.
  // Normalising here keeps the resolved delay a single canonical zero.
  return floored === 0 ? 0 : floored;
}

/**
 * True when the requested delay means "don't schedule a timer at all".
 *
 * Scheduling a `setTimeout(fn, 0)` instead would push the settle into a later
 * task, so a consumer that opted out of debouncing would still see one render
 * with the stale value — the opposite of what `0` asks for.
 */
export function isImmediateDelay(delayMs?: number): boolean {
  return resolveDebounceDelay(delayMs) === 0;
}

/**
 * Reference-stability guard for the settle. Returns `current` when the two
 * are the same value so the hook's `useState` bails out of the re-render
 * instead of swapping in an identical-but-new reference.
 *
 * This matters most for non-primitive values: a caller debouncing an object
 * or array (say a whole `ItemFilters` draft) feeds the result into a
 * `useMemo` dep array downstream, and a fresh reference there re-runs the
 * matcher the debounce exists to protect. `Object.is` rather than `===` so
 * `NaN` settles once rather than on every tick.
 */
export function commitDebouncedValue<T>(current: T, next: T): T {
  return Object.is(current, next) ? current : next;
}
