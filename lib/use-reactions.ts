import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { addReaction, fetchReactions, removeReaction } from "@/lib/supabase-profiles";
import { Reaction, ReactionEmoji, ReactionTargetType } from "@/lib/types";

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
      .then((r) => { if (active) setReactions(r); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [targetType, targetId]);

  const counts = REACTION_EMOJIS.map(({ key, icon }) => ({
    key,
    icon,
    count: reactions.filter((r) => r.emoji === key).length,
    mine: !!user && reactions.some((r) => r.emoji === key && r.userId === user.id),
  }));

  const toggle = useCallback(
    async (emoji: ReactionEmoji) => {
      if (!user) return;
      const existing = reactions.find((r) => r.emoji === emoji && r.userId === user.id);
      // Both writes are optimistic and both put the row back if the cloud
      // refuses: a screen that keeps a reaction the server rejected is stating
      // a fact nothing agrees with, and nothing corrects it until a remount.
      if (existing) {
        setReactions((prev) => prev.filter((r) => r.id !== existing.id));
        try {
          await removeReaction(user.id, targetType, targetId, emoji);
        } catch {
          setReactions((prev) =>
            prev.some((r) => r.id === existing.id) ? prev : [...prev, existing],
          );
        }
      } else {
        const optimistic: Reaction = {
          id: `tmp-${Date.now()}`,
          userId: user.id,
          targetType,
          targetId,
          emoji,
          createdAt: new Date().toISOString(),
        };
        setReactions((prev) => [...prev, optimistic]);
        try {
          await addReaction(user.id, targetType, targetId, emoji);
        } catch {
          setReactions((prev) => prev.filter((r) => r.id !== optimistic.id));
        }
      }
    },
    [user, reactions, targetType, targetId],
  );

  return { counts, toggle, loading, totalCount: reactions.length };
}
