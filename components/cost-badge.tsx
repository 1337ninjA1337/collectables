import { memo } from "react";
import { Platform, Pressable, StyleProp, Text, TextStyle } from "react-native";

import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { formatCostAmount, hasFiniteCost } from "@/lib/item-cost";
import { CollectableItem } from "@/lib/types";

type CostBadgeProps = {
  /**
   * Item mode: converts the stored cost into the viewer's display currency
   * (or the parent collection's currency override, consistent with
   * getCollectionTotalCost), prefixes "≈" on real conversions, and surfaces
   * the original stored amount via accessibilityLabel / web tooltip.
   * Renders nothing when the item has no finite cost.
   */
  item?: CollectableItem;
  /** Raw mode (e.g. collection totals): pre-computed amount — no conversion. */
  amount?: number;
  /** Raw mode: currency code rendered after the amount. */
  currency?: string;
  /** Item mode: prefix the translated cost label ("Cost: 12 USD"). */
  withLabel?: boolean;
  /** Style for the rendered <Text> — the caller owns typography/color. */
  style?: StyleProp<TextStyle>;
  /** Item mode: wrap in a Pressable revealing the original stored amount on long-press. */
  onLongPressOriginal?: (original: string) => void;
};

// Centralises the cost rendering previously duplicated across ItemCard's two
// branches, the item-detail meta row, and the collection total-cost summary.
export const CostBadge = memo(function CostBadge({
  item,
  amount,
  currency,
  withLabel,
  style,
  onLongPressOriginal,
}: CostBadgeProps) {
  const { t } = useI18n();
  const { convertItemCost, getCollectionById } = useCollections();

  if (!item) {
    if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
    return (
      <Text style={style}>
        {formatCostAmount(amount)}{currency ? ` ${currency}` : ""}
      </Text>
    );
  }

  if (!hasFiniteCost(item)) return null;

  const conv = convertItemCost(item, getCollectionById(item.collectionId)?.currency ?? undefined);
  const convAmount = conv.amount ?? (item.cost as number);
  // Prefix the approx marker only when a real conversion changed the currency.
  const approx = conv.converted && item.costCurrency != null && item.costCurrency !== conv.currency;
  const display = approx
    ? t("itemValueApprox", { amount: formatCostAmount(convAmount), currency: conv.currency })
    : `${formatCostAmount(convAmount)} ${conv.currency}`;
  const original = `${formatCostAmount(item.cost as number)}${item.costCurrency ? ` ${item.costCurrency}` : ""}`;
  const tooltipProps = {
    accessibilityLabel: `${t("costLabel")}: ${original}`,
    ...(Platform.OS === "web" ? ({ title: original } as object) : null),
  };
  const text = withLabel ? `${t("costLabel")}: ${display}` : display;

  if (onLongPressOriginal) {
    return (
      <Pressable onLongPress={() => onLongPressOriginal(original)} {...tooltipProps}>
        <Text style={style}>{text}</Text>
      </Pressable>
    );
  }

  return (
    <Text style={style} {...tooltipProps}>
      {text}
    </Text>
  );
});
