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
    if (!targetId) return;
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
      if (existing) {
        setReactions((prev) => prev.filter((r) => r.id !== existing.id));
        await removeReaction(user.id, targetType, targetId, emoji).catch(() => {});
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
        await addReaction(user.id, targetType, targetId, emoji).catch(() => {});
      }
    },
    [user, reactions, targetType, targetId],
  );

  return { counts, toggle, loading, totalCount: reactions.length };
}
