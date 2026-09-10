/**
 * The reorder a screen reader can perform, as props instead of as twelve lines
 * per row.
 *
 * ## What this replaces
 *
 * `app/index.tsx` and `app/collection/[id].tsx` each carried the same wiring,
 * character for character apart from which array and which writer they named:
 * a can-move-up / can-move-down pair, a conditional spread so an action that
 * would do nothing is never offered, an undefined-index guard, the `moveItem`
 * call, the announcement, a switch on the action name, and — the last piece to
 * move here — the long press that announces the pick-up and then starts the
 * drag. Two copies of seven decisions, in two files nobody diffs against each
 * other.
 *
 * ## Why it is a function and not a hook
 *
 * It is called from inside `renderItem`, which is a callback the list invokes
 * per row rather than a component React renders — a hook there is a
 * rules-of-hooks violation, and the ordering it depends on does not exist. Same
 * reason `announceReorder` takes `t` as a parameter.
 *
 * ## Why `commit` and `announce` are parameters
 *
 * `announceReorder` reaches `react-native` (or, on web, the DOM), and this
 * module is the half a node suite can run: every decision here — which actions
 * exist, which index they land on, when to do nothing at all — is asserted
 * against plain arrays. The screens keep the two one-line closures that name
 * their own writer and their own translations.
 */

import { moveItem } from "@/lib/drag-reorder";
import type { ReorderAnnouncement } from "@/lib/reorder-announcement";

/**
 * The role a row carrying custom actions announces itself as.
 *
 * `accessibilityActions` on a node with no role is announced inconsistently:
 * TalkBack reads the actions off anything focusable, VoiceOver frequently does
 * not offer the rotor at all until the element claims a role. Both rows are
 * `Pressable`s that open something, so `button` is what they are.
 */
export const REORDER_ROW_ROLE = "button" as const;

/** The two actions, and the i18n keys they are labelled with. */
export const REORDER_ACTIONS = ["moveUp", "moveDown"] as const;
export type ReorderActionName = (typeof REORDER_ACTIONS)[number];

/** How far each action moves a row. */
const DELTA: Readonly<Record<ReorderActionName, number>> = {
  moveUp: -1,
  moveDown: 1,
};

/** One entry of React Native's `accessibilityActions` array. */
export type ReorderAccessibilityAction = {
  readonly name: ReorderActionName;
  readonly label: string;
};

/** Everything a row spreads to become reorderable, with a pointer or without. */
export type ReorderActionProps = {
  readonly accessibilityActions: readonly ReorderAccessibilityAction[];
  readonly onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => void;
  readonly accessibilityRole: typeof REORDER_ROW_ROLE;
  /**
   * The pointer route, announced and then started — `undefined` when the
   * caller passed no `drag`, which is how a viewer's row gets no long press at
   * all rather than one that announces a pick-up they cannot perform.
   */
  readonly onLongPress: (() => void) | undefined;
};

/**
 * The rows a move happens within, either as they are or as a way of asking.
 *
 * A plain array is the array from the RENDER THAT DREW THE ROW, and there is a
 * gap between that render and the action firing: a screen reader focuses a
 * card, a cloud merge or a `loadMore` lands, and the handler still closes over
 * the old list. Committing it renumbers an order the user is not looking at.
 * A function is read at action time instead — back it with a ref that each
 * render updates and the gap closes. The web drag shim solved the same problem
 * the same way.
 *
 * Both are accepted because the availability question ("is this row last?") is
 * a render-time one either way, and a caller with no staleness to worry about
 * should not have to build a ref to say so.
 */
export type ReorderRows<T> = readonly T[] | (() => readonly T[]);

/** Whichever form the caller used, as an array. */
function resolveRows<T>(rows: ReorderRows<T>): readonly T[] {
  return typeof rows === "function" ? rows() : rows;
}

export type ReorderActionOptions<T> = {
  /**
   * The list the move happens WITHIN — see {@link ReorderRows} for why this
   * may be a function, and what a plain array costs.
   */
  readonly rows: ReorderRows<T>;
  /**
   * This row's place in `rows`, straight from `getIndex()`.
   *
   * `undefined` for a windowed row the list has not placed yet. Not a defect
   * and not clamped to 0: `undefined + 1` reaches `moveItem` as `NaN`, and a
   * row whose position is unknown has no move to offer.
   */
  readonly index: number | undefined;
  /**
   * False when reordering is blocked for a reason that is not this row's —
   * `app/collection/[id].tsx` passes `isDragBranch`, since under a non-default
   * sort the visible order is not the manual one and committing it corrupts
   * what the owner arranged. Defaults to true.
   */
  readonly enabled?: boolean;
  /** The action's label, as a screen reader will read it — `t` in practice. */
  readonly label: (key: ReorderActionName) => string;
  /** Persist the new order. Receives the whole of `rows`, reordered. */
  readonly commit: (next: T[]) => void;
  /**
   * Say what just happened: which moment, the 0-based position it is about,
   * and the list's length.
   *
   * `at` is `number | undefined` because the pick-up can fire on a row the
   * list has not placed. `announcedPosition` refuses that rather than reading
   * a guess aloud, so the caller passes it straight through.
   */
  readonly announce: (key: ReorderAnnouncement, at: number | undefined, total: number) => void;
  /**
   * Start the pointer drag. Omitted for a row that may not be dragged — a
   * viewer's — which is what leaves `onLongPress` undefined.
   */
  readonly drag?: () => void;
  /**
   * How to find THIS row again in a list that may have changed since it was
   * drawn.
   *
   * `index` is the render's answer and `rows` is now the action's, and that is
   * only half a fix: re-checking whether a move exists at the old index says
   * nothing about whether the row is still sitting there. A cloud merge that
   * reorders the list leaves the index pointing at a different card, and the
   * move goes to whatever now occupies it — the user asked to move Alpha and
   * Beta moves.
   *
   * Matched by KEY rather than by reference, because a merge rebuilds the
   * objects: the same collection comes back as a new object with the same id,
   * and `indexOf` would not find it. A row the key cannot find is a row that
   * left the list, and the action does nothing.
   *
   * Optional: a caller whose list cannot be reordered underneath it passes
   * nothing and keeps the render's index.
   */
  readonly identify?: {
    readonly row: T;
    readonly keyOf: (row: T) => string;
  };
};

/**
 * Which of the two moves would actually change the order.
 *
 * An action a screen reader announces as available and that then does nothing
 * is worse than one it never mentions — the listener has no way to tell "it
 * moved" from "it was already there". `moveItem` clamps, so "move up" on the
 * first row is a silent no-op; this is what keeps it from being offered.
 */
export function availableReorderActions<T>(
  rows: ReorderRows<T>,
  index: number | undefined,
  enabled = true,
): ReorderActionName[] {
  if (!enabled || index === undefined) return [];
  const length = resolveRows(rows).length;
  return REORDER_ACTIONS.filter((name) => {
    const to = index + DELTA[name];
    return to >= 0 && to < length;
  });
}

/**
 * Where this row sits in the list AS IT IS NOW, or null when it has left it.
 *
 * Without an `identify` this is the render's index, unchanged — the behaviour
 * a caller with a stable list wants and the only thing available before
 * `identify` existed. With one, the row is found by key, and "not found" is a
 * row the list no longer holds: deleted, filtered out, moved to another
 * collection. Doing nothing is the only correct answer there; falling back to
 * the render's index would move whichever card inherited the slot.
 */
function currentIndexOf<T>(
  rows: readonly T[],
  index: number,
  identify: ReorderActionOptions<T>["identify"],
): number | null {
  if (!identify) return index;
  const key = identify.keyOf(identify.row);
  const found = rows.findIndex((row) => identify.keyOf(row) === key);
  return found === -1 ? null : found;
}

/**
 * The `accessibilityActions` / `onAccessibilityAction` pair for one row.
 *
 * The handler answers only to the actions this row actually offers, so an
 * action name arriving from anywhere else — a platform that remembers an
 * action after the row stopped offering it, another `accessibilityActions`
 * entry the screen adds later — cannot move anything.
 */
export function reorderActionProps<T>(options: ReorderActionOptions<T>): ReorderActionProps {
  const { rows, index, enabled, label, commit, announce, drag, identify } = options;
  const available = availableReorderActions(rows, index, enabled);

  return {
    accessibilityActions: available.map((name) => ({ name, label: label(name) })),
    onAccessibilityAction: (event) => {
      const name = event.nativeEvent.actionName as ReorderActionName;
      if (index === undefined || !available.includes(name)) return;
      // Read NOW, not at render: see ReorderRows. `moveItem` is total, so a
      // list that shrank between the two reads clamps rather than throwing —
      // and `availableReorderActions` re-run against the fresh list is what
      // decides whether the move still exists at all.
      const current = resolveRows(rows);
      const from = currentIndexOf(current, index, identify);
      if (from === null) return;
      if (!availableReorderActions(current, from, enabled).includes(name)) return;
      const to = from + DELTA[name];
      commit(moveItem(current, from, to));
      announce("reorderMoved", to, current.length);
    },
    accessibilityRole: REORDER_ROW_ROLE,
    onLongPress:
      drag === undefined
        ? undefined
        : () => {
            // Before `drag()`, not after: once the gesture starts the row is
            // being held rather than sitting at a position, and a pick-up read
            // aloud from mid-drag names wherever the finger has reached.
            announce("reorderPickedUp", index, resolveRows(rows).length);
            drag();
          },
  };
}
