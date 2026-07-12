import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { VisibilityBadge } from "@/components/visibility-badge";
import { MUTED_26, PURE_WHITE, RADIUS_CARD_AIRY, SPACING_CARD, SPACING_INLINE, TEXT_ON_DARK_10, TEXT_ON_DARK_11, TEXT_ON_DARK_12, TEXT_ON_DARK_13 } from "@/lib/design-tokens";
import { formatCostAmount } from "@/lib/format-cost";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { Collection } from "@/lib/types";
import { FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD } from "@/lib/fonts";

export function CollectionCard({
  collection,
  count,
  totalCost,
  totalCostCurrency,
}: {
  collection: Collection;
  count: number;
  totalCost?: number;
  totalCostCurrency?: string;
}) {
  const { t } = useI18n();
  const hasCover = Boolean(collection.coverPhoto);

  return (
    <Link href={`/collection/${collection.id}`} asChild>
      <Pressable style={{...styles.card, ...(!hasCover ? { backgroundColor: placeholderColor(collection.id) } : {})}}>
        {hasCover ? <Image source={{ uri: collection.coverPhoto }} style={styles.image} /> : null}
        <LinearGradient
          colors={["rgba(34, 24, 17, 0.08)", "rgba(34, 24, 17, 0.55)"]}
          style={styles.overlay}
        />
        <View style={styles.content}>
          <View style={styles.topRow}>
            <VisibilityBadge collection={collection} />
            <Text style={styles.count}>{t("itemsCount", { count })}</Text>
          </View>
          <Text style={styles.title}>{collection.name}</Text>
          <Text style={styles.description}>{collection.description}</Text>
          {collection.role === "owner" && collection.visibility !== "public" ? (
            <Text style={styles.meta}>
              {t("sharedWithPeople", { count: collection.sharedWith.length })}
            </Text>
          ) : collection.role !== "owner" ? (
            <Text style={styles.meta}>
              {t("ownerLabel", { name: collection.ownerName })}
            </Text>
          ) : null}
          {typeof totalCost === "number" && totalCost > 0 ? (
            <Text style={styles.meta}>
              {t("totalCost")}: {formatCostAmount(totalCost)}
              {totalCostCurrency ? ` ${totalCostCurrency}` : ""}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 220,
    borderRadius: RADIUS_CARD_AIRY,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: MUTED_26,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    padding: 20,
    gap: SPACING_INLINE,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: SPACING_CARD,
  },
  role: {
    color: TEXT_ON_DARK_10,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontFamily: FONT_BODY_BOLD,
  },
  count: {
    color: TEXT_ON_DARK_11,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: FONT_BODY_SEMIBOLD,
  },
  title: {
    color: PURE_WHITE,
    fontSize: 28,
    fontWeight: "700",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  description: {
    color: TEXT_ON_DARK_12,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  meta: {
    color: TEXT_ON_DARK_13,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: FONT_BODY_SEMIBOLD,
  },
});
