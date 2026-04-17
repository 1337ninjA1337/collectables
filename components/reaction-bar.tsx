import { Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/lib/i18n-context";
import { REACTION_EMOJIS, useReactions } from "@/lib/use-reactions";
import { ReactionTargetType } from "@/lib/types";

type Props = {
  targetType: ReactionTargetType;
  targetId: string;
};

export function ReactionBar({ targetType, targetId }: Props) {
  const { t } = useI18n();
  const { counts, toggle, loading } = useReactions(targetType, targetId);

  if (loading) return null;

  const hasAny = counts.some((c) => c.count > 0);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t("reactions")}</Text>
      <View style={styles.row}>
        {counts.map((item) => (
          <Pressable
            key={item.key}
            style={{
              ...styles.chip,
              ...(item.mine ? styles.chipActive : {}),
              ...(item.count > 0 ? styles.chipWithCount : {}),
            }}
            onPress={() => void toggle(item.key)}
          >
            <Text style={styles.emoji}>{item.icon}</Text>
            {item.count > 0 ? (
              <Text style={{ ...styles.count, ...(item.mine ? styles.countActive : {}) }}>
                {item.count}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  label: {
    color: "#8f6947",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "800",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  chipActive: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  chipWithCount: {
    paddingHorizontal: 14,
  },
  emoji: {
    fontSize: 18,
  },
  count: {
    fontSize: 13,
    fontWeight: "800",
    color: "#6b5647",
  },
  countActive: {
    color: "#fff7ef",
  },
});
