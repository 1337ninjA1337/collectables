import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { planReactionToggle, rollbackReactionToggle } from "@/lib/reaction-toggle";
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

      // Both writes are optimistic and both put the row back if the cloud
      // refuses: a screen that keeps a reaction the server rejected is stating
      // a fact nothing agrees with, and nothing corrects it until a remount.
      apply(() => plan.rows);
      try {
        if (plan.kind === "add") {
          await addReaction(user.id, targetType, targetId, emoji);
        } else {
          await removeReaction(user.id, targetType, targetId, emoji);
        }
      } catch {
        apply((rows) => rollbackReactionToggle(rows, plan));
      }
    },
    // Not `reactions`: the rows are read through `latest` now, so the handler
    // keeps one identity for the life of the target instead of a new one per
    // tap — which is what let two taps close over the same list.
    [user, targetType, targetId, apply],
  );

  return { counts, toggle, loading, totalCount: reactions.length };
}
