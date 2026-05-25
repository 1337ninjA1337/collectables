import { Link } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { withCloudinaryThumbUrl } from "@/lib/cloudinary-url";
import {
  AMBER_MUTED_3,
  BORDER,
  CARD_BG,
  HERO_DARK,
  MUTED_28,
  MUTED_29,
  TEXT_DARK_5,
  TEXT_ON_DARK,
} from "@/lib/design-tokens";
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
            <Image
              source={{ uri: withCloudinaryThumbUrl(item.photos[0], { width: 480, height: 360, mode: "fill" }) }}
              style={styles.compactImage}
            />
          ) : (
            <View style={[styles.compactImage, { backgroundColor: placeholderColor(item.id) }]} />
          )}
          <Text style={styles.compactTitle} numberOfLines={2}>{item.title}</Text>
          {typeof item.cost === "number" ? (
            <Text style={styles.compactCost}>
              {t("costLabel")}: {item.cost}{item.costCurrency ? ` ${item.costCurrency}` : ""}
            </Text>
          ) : null}
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href={`/item/${item.id}`} asChild>
      <Pressable style={styles.card}>
        {hasPhoto ? (
          <Image
            source={{ uri: withCloudinaryThumbUrl(item.photos[0], { width: 320, height: 320, mode: "fill" }) }}
            style={styles.image}
          />
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
              <Text style={styles.meta}>
                {t("costLabel")}: {item.cost}{item.costCurrency ? ` ${item.costCurrency}` : ""}
              </Text>
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
    backgroundColor: CARD_BG,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  image: {
    width: 104,
    height: 104,
    borderRadius: 18,
    backgroundColor: AMBER_MUTED_3,
  },
  textWrap: {
    flex: 1,
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    color: TEXT_DARK_5,
    fontFamily: FONT_DISPLAY_BOLD,
  },
  description: {
    color: MUTED_28,
    lineHeight: 20,
    fontFamily: FONT_BODY,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  meta: {
    color: MUTED_29,
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
    backgroundColor: HERO_DARK,
  },
  conditionBadgeText: {
    color: TEXT_ON_DARK,
    fontSize: 11,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  compactCard: {
    borderRadius: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
    gap: 8,
    paddingBottom: 10,
  },
  compactImage: {
    width: "100%",
    height: 110,
    borderRadius: 16,
    backgroundColor: AMBER_MUTED_3,
  },
  compactTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT_DARK_5,
    paddingHorizontal: 10,
    fontFamily: FONT_DISPLAY_BOLD,
  },
  compactCost: {
    fontSize: 12,
    color: MUTED_29,
    fontWeight: "600",
    paddingHorizontal: 10,
    fontFamily: FONT_BODY_SEMIBOLD,
  },
});
