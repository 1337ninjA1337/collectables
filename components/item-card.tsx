import { Link } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { CollectableItem } from "@/lib/types";
import { FONT_DISPLAY, FONT_DISPLAY_BOLD, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD } from "@/lib/fonts";

type ItemCardProps = { item: CollectableItem; compact?: boolean };

export function ItemCard({ item, compact }: ItemCardProps) {
  const { t } = useI18n();
  const hasPhoto = item.photos.length > 0 && Boolean(item.photos[0]);

  if (compact) {
    return (
      <Link href={`/item/${item.id}`} asChild>
        <Pressable style={styles.compactCard}>
          {hasPhoto ? (
            <Image source={{ uri: item.photos[0] }} style={styles.compactImage} />
          ) : (
            <View style={[styles.compactImage, { backgroundColor: placeholderColor(item.id) }]} />
          )}
          <Text style={styles.compactTitle} numberOfLines={2}>{item.title}</Text>
          {typeof item.cost === "number" ? (
            <Text style={styles.compactCost}>{t("costLabel")}: {item.cost}</Text>
          ) : null}
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href={`/item/${item.id}`} asChild>
      <Pressable style={styles.card}>
        {hasPhoto ? (
          <Image source={{ uri: item.photos[0] }} style={styles.image} />
        ) : (
          <View style={{...styles.image, backgroundColor: placeholderColor(item.id)}} />
        )}
        <View style={styles.textWrap}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{item.acquiredFrom}</Text>
            <Text style={styles.meta}>{t("photosCount", { count: item.photos.length })}</Text>
          </View>
          {item.tags && item.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {item.tags.map((tag, i) => (
                <View key={i} style={{...styles.tagBadge, backgroundColor: tag.color}}>
                  <Text style={styles.tagBadgeText}>{tag.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.metaRow}>
            {item.condition ? (
              <View style={styles.conditionBadge}>
                <Text style={styles.conditionBadgeText}>
                  {t(`condition${item.condition[0].toUpperCase()}${item.condition.slice(1)}` as "conditionNew" | "conditionExcellent" | "conditionGood" | "conditionFair")}
                </Text>
              </View>
            ) : null}
            {typeof item.cost === "number" ? (
              <Text style={styles.meta}>{t("costLabel")}: {item.cost}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 14,
    alignItems: "stretch",
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    padding: 12,
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  image: {
    width: 104,
    height: 104,
    borderRadius: 18,
    backgroundColor: "#d8c7b1",
  },
  textWrap: {
    flex: 1,
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    color: "#312218",
    fontFamily: FONT_DISPLAY_BOLD,
  },
  description: {
    color: "#6a5647",
    lineHeight: 20,
    fontFamily: FONT_BODY,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  meta: {
    color: "#8d6c4a",
    fontSize: 13,
    fontWeight: "600",
    fontFamily: FONT_BODY_SEMIBOLD,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  tagBadge: {
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  tagBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  conditionBadge: {
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
    backgroundColor: "#261b14",
  },
  conditionBadgeText: {
    color: "#fff7ef",
    fontSize: 11,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  compactCard: {
    borderRadius: 18,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    overflow: "hidden",
    gap: 8,
    paddingBottom: 10,
  },
  compactImage: {
    width: "100%",
    height: 110,
    borderRadius: 16,
    backgroundColor: "#d8c7b1",
  },
  compactTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#312218",
    paddingHorizontal: 10,
    fontFamily: FONT_DISPLAY_BOLD,
  },
  compactCost: {
    fontSize: 12,
    color: "#8d6c4a",
    fontWeight: "600",
    paddingHorizontal: 10,
    fontFamily: FONT_BODY_SEMIBOLD,
  },
});
