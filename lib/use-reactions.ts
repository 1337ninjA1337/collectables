import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { planReactionToggle, rollbackReactionToggle } from "@/lib/reaction-toggle";
import { createReactionWriteQueue, reactionWriteKey } from "@/lib/reaction-write-queue";
import { addReaction, fetchReactions, removeReaction } from "@/lib/supabase-profiles";
import { Reaction, ReactionEmoji, ReactionTargetType } from "@/lib/types";
import { generateUuidV4 } from "@/lib/uuid";

export const REACTION_EMOJIS: { key: ReactionEmoji; icon: string }[] = [
  { key: "heart", icon: "\u2764\uFE0F" },
  { key: "fire", icon: "\uD83D\uDD25" },
  { key: "eyes", icon: "\uD83D\uDC40" },
  { key: "star", icon: "\u2B50" },
  { key: "clap", icon: "\uD83D\uDC4F" },
];

export function useReactions(targetType: ReactionTargetType, targetId: string) {
  const { user } = useAuth();
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * The rows as they are NOW, which React state cannot answer between renders.
   *
   * Two taps in one pass — the emoji are 44 points apart and a double tap is
   * one gesture — both used to read `reactions` from the same closure, both
   * find no row of their own, and both insert: two optimistic hearts and two
   * inserts sent to a table that allows one. A `setReactions` updater sees the
   * real previous list, but the DIRECTION of the tap has to be decided
   * synchronously (it picks which network call to make), and the updater's
   * argument is not available then.
   *
   * So the writer keeps its own copy and updates it before React re-renders.
   * Every mutation goes through `apply` — the fetch included — or the two
   * answers drift and the ref becomes the stale one.
   */
  const latest = useRef<Reaction[]>(reactions);
  const apply = useCallback((next: (rows: readonly Reaction[]) => Reaction[]) => {
    latest.current = next(latest.current);
    setReactions(latest.current);
  }, []);

  /**
   * The writes, collapsed: on-then-off in one gesture leaves the device alone.
   *
   * Everything the write needs is on `plan.row`, so the queue does not depend
   * on `user` or the target and is built once for the life of the mount —
   * which is also what keeps `toggle`'s identity stable for the memoized bar.
   */
  const queue = useMemo(
    () =>
      createReactionWriteQueue({
        write: async (plan) => {
          const { userId, targetType: type, targetId: id, emoji } = plan.row;
          if (plan.kind === "add") await addReaction(userId, type, id, emoji);
          else await removeReaction(userId, type, id, emoji);
        },
        // Both directions are optimistic and both put the row back if the
        // cloud refuses: a screen that keeps a reaction the server rejected is
        // stating a fact nothing agrees with, and nothing corrects it until a
        // remount.
        onFailure: (plan) => apply((rows) => rollbackReactionToggle(rows, plan)),
      }),
    [apply],
  );

  // A tap inside the window followed by a back-swipe would otherwise sit in a
  // timer nothing is left to fire it. The flush sends it; the window is a
  // batching delay, never a way to lose a reaction.
  useEffect(() => () => void queue.flush(), [queue]);

  useEffect(() => {
    // No target yet — the first pass of a detail screen, before the route
    // param resolves. There is nothing to read, but the bar renders only its
    // spinner while `loading` is true, so returning without clearing it left
    // one turning for the life of the mount.
    if (!targetId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    fetchReactions(targetType, targetId)
      .then((r) => { if (active) apply(() => r); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [targetType, targetId, apply]);

  const counts = REACTION_EMOJIS.map(({ key, icon }) => ({
    key,
    icon,
    count: reactions.filter((r) => r.emoji === key).length,
    mine: !!user && reactions.some((r) => r.emoji === key && r.userId === user.id),
  }));

  const toggle = useCallback(
    async (emoji: ReactionEmoji) => {
      if (!user) return;
      // A uuid, not `tmp-${Date.now()}`: two taps in the same millisecond minted
      // the same id, and the rollback of either one then removed both. It is
      // also the id class every other locally-minted row in this app uses — see
      // `lib/item-id.ts` for what the legacy scheme cost there.
      const plan = planReactionToggle({
        rows: latest.current,
        userId: user.id,
        targetType,
        targetId,
        emoji,
        id: generateUuidV4(),
        createdAt: new Date().toISOString(),
      });

      // The list moves now; the cloud is told once the direction has settled.
      // Two taps on one emoji are one gesture and net to nothing, so the queue
      // drops the pair instead of sending an INSERT and a DELETE for a row the
      // server would create and drop microseconds apart.
      apply(() => plan.rows);
      await queue.submit(reactionWriteKey(targetType, targetId, emoji), plan);
    },
    // Not `reactions`: the rows are read through `latest` now, so the handler
    // keeps one identity for the life of the target instead of a new one per
    // tap — which is what let two taps close over the same list.
    [user, targetType, targetId, apply, queue],
  );

  return { counts, toggle, loading, totalCount: reactions.length };
}
