import { memo } from "react";
import { Link } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { withCloudinaryThumbUrl } from "@/lib/cloudinary-url";
import { useCollections } from "@/lib/collections-context";
import { formatCostAmount } from "@/lib/item-cost";
import {
  AMBER_MUTED_3,
  HERO_DARK,
  PURE_WHITE,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SHADOW_SOFT,
  SPACING_INLINE,
  TEXT_ON_DARK,
} from "@/lib/design-tokens";
import { LazyPhoto } from "@/components/lazy-photo";
import { useAppTheme } from "@/components/use-app-theme";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { CollectableItem } from "@/lib/types";
import { FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD } from "@/lib/fonts";

type ItemCardProps = { item: CollectableItem; compact?: boolean };

// VM-F: memoized like SelectableItemRow — the named-function form keeps the
// component name visible in React DevTools' profiler tree. Context consumers
// (i18n/theme/collections) still re-render the card on context changes;
// memo skips only parent-driven re-renders with referentially stable props.
export const ItemCard = memo(function ItemCard({ item, compact }: ItemCardProps) {
  const { t } = useI18n();
  const theme = useAppTheme();
  const { convertItemCost, getCollectionById } = useCollections();
  const hasPhoto = item.photos.length > 0 && Boolean(item.photos[0]);

  // Convert the stored cost into the viewer's display currency (or the parent
  // collection's currency override, consistent with getCollectionTotalCost).
  // `costApprox` flags a real conversion so we prefix "≈"; the original
  // amount+currency is surfaced as an accessibility label / web tooltip.
  const hasCost = typeof item.cost === "number" && Number.isFinite(item.cost);
  const cost = hasCost
    ? convertItemCost(item, getCollectionById(item.collectionId)?.currency ?? undefined)
    : null;
  const costAmount = cost ? cost.amount ?? (item.cost as number) : 0;
  const costApprox = cost
    ? cost.converted && item.costCurrency != null && item.costCurrency !== cost.currency
    : false;
  const costDisplay = !cost
    ? ""
    : costApprox
      ? t("itemValueApprox", { amount: formatCostAmount(costAmount), currency: cost.currency })
      : `${formatCostAmount(costAmount)} ${cost.currency}`;
  const costOriginal = hasCost
    ? `${formatCostAmount(item.cost as number)}${item.costCurrency ? ` ${item.costCurrency}` : ""}`
    : "";
  const costTooltipProps = cost
    ? {
        accessibilityLabel: `${t("costLabel")}: ${costOriginal}`,
        ...(Platform.OS === "web" ? ({ title: costOriginal } as object) : null),
      }
    : null;

  if (compact) {
    return (
      <Link href={`/item/${item.id}`} asChild>
        <Pressable style={{ ...styles.compactCard, backgroundColor: theme.card, borderColor: theme.border }}>
          {hasPhoto ? (
            <LazyPhoto
              uri={withCloudinaryThumbUrl(item.photos[0], { width: 480, height: 360, mode: "fill" })}
              style={styles.compactImage}
              fallbackColor={placeholderColor(item.id)}
            />
          ) : (
            <View style={[styles.compactImage, { backgroundColor: placeholderColor(item.id) }]} />
          )}
          <Text style={{ ...styles.compactTitle, color: theme.text }} numberOfLines={2}>{item.title}</Text>
          {cost ? (
            <Text style={{ ...styles.compactCost, color: theme.meta }} {...costTooltipProps}>
              {t("costLabel")}: {costDisplay}
            </Text>
          ) : null}
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href={`/item/${item.id}`} asChild>
      <Pressable style={{ ...styles.card, backgroundColor: theme.card, borderColor: theme.border, ...SHADOW_SOFT }}>
        {hasPhoto ? (
          <LazyPhoto
            uri={withCloudinaryThumbUrl(item.photos[0], { width: 320, height: 320, mode: "fill" })}
            style={styles.image}
            fallbackColor={placeholderColor(item.id)}
          />
        ) : (
          <View style={{...styles.image, backgroundColor: placeholderColor(item.id)}} />
        )}
        <View style={styles.textWrap}>
          <Text style={{ ...styles.title, color: theme.text }}>{item.title}</Text>
          <Text style={{ ...styles.description, color: theme.muted }} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.metaRow}>
            <Text style={{ ...styles.meta, color: theme.meta }}>{item.acquiredFrom}</Text>
            <Text style={{ ...styles.meta, color: theme.meta }}>{t("photosCount", { count: item.photos.length })}</Text>
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
            {cost ? (
              <Text style={{ ...styles.meta, color: theme.meta }} {...costTooltipProps}>
                {t("costLabel")}: {costDisplay}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 14,
    alignItems: "stretch",
    borderRadius: RADIUS_ITEM_AIRY,
    padding: 12,
    borderWidth: 1,
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
    gap: SPACING_INLINE,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  description: {
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: SPACING_INLINE,
  },
  meta: {
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
    borderRadius: RADIUS_PILL,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  tagBadgeText: {
    color: PURE_WHITE,
    fontSize: 10,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  conditionBadge: {
    borderRadius: RADIUS_PILL,
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
    borderWidth: 1,
    overflow: "hidden",
    gap: SPACING_INLINE,
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
    paddingHorizontal: 10,
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  compactCost: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 10,
    fontFamily: FONT_BODY_SEMIBOLD,
  },
});
