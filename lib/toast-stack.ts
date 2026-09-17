/**
 * How many toasts the overlay may show at once.
 *
 * The queue in `toast-context.tsx` was append-only: `show()` pushed, and the
 * only thing that ever removed an entry was that entry's own dismissal timer.
 * That is fine for the calls this app actually makes — one toast, occasionally
 * two — and wrong for the case it cannot rule out. A loop that fails per item
 * (a bulk save over a dead connection, a sync that reports each row) queues one
 * toast per failure, the stack grows downward past the fold, and every one of
 * them is `zIndex: 9999` over the top of the screen the user is trying to use.
 * Worse with the hold: a pointer resting anywhere in that column stops the
 * toast under it from counting down at all.
 *
 * So the stack has a depth, and the OLDEST goes when a new one arrives. That
 * direction is the whole decision. The newest toast is the one describing what
 * just happened, and it is the only one that can still carry a usable action —
 * an undo from four failures ago is not what the user is reaching for.
 *
 * Three, because it is the largest number that fits under a phone's status bar
 * without becoming the screen, and because a stack that shows one at a time
 * would hide the second half of a two-step outcome ("saved" then "sync
 * failed") — which is the pair this app most often shows.
 *
 * Its own module rather than a constant in the provider, for the reason every
 * toast rule here has one: `toast-context.tsx` pulls React Native and cannot
 * be imported under `tsx --test`, so a policy that lived there could only be
 * checked by grepping for its own source text.
 */

/** The most toasts on screen at once. */
export const TOAST_STACK_MAX = 3;

/**
 * Keep the newest `max` entries, dropping the oldest.
 *
 * Generic rather than typed to `ToastItem` so this module does not import the
 * provider — the item type is declared beside the queue, which is beside React
 * Native. It takes the whole list rather than "the list and the new one" so
 * that it composes with the append the caller was already doing, and so a list
 * that is already short is returned AS IS: a fresh array on every `show()`
 * would re-render every toast in the stack, restart their entrance animations,
 * and — because the effect keys off identity — reset the very timers this is
 * supposed to bound.
 */
export function capToastStack<T>(items: T[], max: number = TOAST_STACK_MAX): T[] {
  if (max <= 0) return [];
  if (items.length <= max) return items;
  return items.slice(items.length - max);
}
