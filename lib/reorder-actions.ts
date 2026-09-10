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
 * call, the announcement, and a switch on the action name. Two copies of six
 * decisions, in two files nobody diffs against each other.
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

/** The two props a row spreads to become reorderable without a pointer. */
export type ReorderActionProps = {
  readonly accessibilityActions: readonly ReorderAccessibilityAction[];
  readonly onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => void;
};

export type ReorderActionOptions<T> = {
  /** The rows as they are rendered — the list the move happens WITHIN. */
  readonly rows: readonly T[];
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
  /** Say where the row landed: 0-based position, and the list's length. */
  readonly announce: (to: number, total: number) => void;
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
  rows: readonly T[],
  index: number | undefined,
  enabled = true,
): ReorderActionName[] {
  if (!enabled || index === undefined) return [];
  return REORDER_ACTIONS.filter((name) => {
    const to = index + DELTA[name];
    return to >= 0 && to < rows.length;
  });
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
  const { rows, index, enabled, label, commit, announce } = options;
  const available = availableReorderActions(rows, index, enabled);

  return {
    accessibilityActions: available.map((name) => ({ name, label: label(name) })),
    onAccessibilityAction: (event) => {
      const name = event.nativeEvent.actionName as ReorderActionName;
      if (index === undefined || !available.includes(name)) return;
      const to = index + DELTA[name];
      commit(moveItem(rows, index, to));
      announce(to, rows.length);
    },
  };
}
