/**
 * What one tap on an emoji does to the list of reactions, decided away from
 * React.
 *
 * `lib/use-reactions.ts` writes optimistically: the row appears (or vanishes)
 * before the cloud is told, and goes back if the cloud refuses. That is three
 * decisions — which direction the tap is, what the list looks like after it,
 * and what "back" means when the write fails — and all three were inline in a
 * `useCallback` that also owned the two network calls.
 *
 * They are here because the failure they guard against is a sequence: tap,
 * tap, reject. A hook can be mounted and driven, and that suite exists; what
 * it cannot do cheaply is enumerate the orders these three can happen in.
 */

import type { Reaction, ReactionEmoji, ReactionTargetType } from "@/lib/types";

/**
 * A tap, as a direction plus the row it is about and the list it produces.
 *
 * The row is carried rather than looked up again on failure: for an add it is
 * the optimistic row to take back out, and for a remove it is the row the
 * server would not delete and that therefore has to go back exactly as it was.
 * Re-finding either one after the write settles means searching a list that
 * other taps have changed in the meantime.
 */
export type ReactionToggle = {
  readonly kind: "add" | "remove";
  readonly row: Reaction;
  readonly rows: Reaction[];
};

/**
 * The tap's direction and its result, read off the rows as they are NOW.
 *
 * "Mine" is the pair (user, emoji) — one reaction per emoji per person, which
 * is what the bar's `mine` flag means and what the cloud's unique constraint
 * enforces. A second row for the same pair should not exist; if one does, the
 * first is removed and the tap after that removes the next, which is the only
 * behaviour that can drain it.
 *
 * `id` and `createdAt` are passed in rather than minted here so a caller can
 * be deterministic about both — the id in particular has to be unique against
 * every row already in the list, including one added microseconds earlier by a
 * tap that has not been re-rendered yet.
 */
export function planReactionToggle(params: {
  readonly rows: readonly Reaction[];
  readonly userId: string;
  readonly targetType: ReactionTargetType;
  readonly targetId: string;
  readonly emoji: ReactionEmoji;
  readonly id: string;
  readonly createdAt: string;
}): ReactionToggle {
  const { rows, userId, targetType, targetId, emoji, id, createdAt } = params;
  const existing = rows.find((row) => row.emoji === emoji && row.userId === userId);

  if (existing) {
    return {
      kind: "remove",
      row: existing,
      rows: rows.filter((row) => row.id !== existing.id),
    };
  }

  const optimistic: Reaction = { id, userId, targetType, targetId, emoji, createdAt };
  return { kind: "add", row: optimistic, rows: [...rows, optimistic] };
}

/**
 * The list with a refused tap undone, against whatever the list is by then.
 *
 * Not "the list from before the tap": between the optimistic write and the
 * rejection the user can tap a second emoji, a re-read can land, another
 * reaction can arrive. Restoring the earlier snapshot would take those away
 * too — one failed write reverting changes it has nothing to do with.
 *
 * Both directions are idempotent, because a rollback can race the re-read that
 * already corrected the row: a removed row is not removed twice, and a
 * restored one is not added twice.
 */
export function rollbackReactionToggle(
  rows: readonly Reaction[],
  toggle: ReactionToggle,
): Reaction[] {
  if (toggle.kind === "add") {
    return rows.filter((row) => row.id !== toggle.row.id);
  }
  return rows.some((row) => row.id === toggle.row.id) ? [...rows] : [...rows, toggle.row];
}
