import { memo, useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Link } from "expo-router";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { withCloudinaryThumbUrl } from "@/lib/cloudinary-url";
import {
  AMBER_ACCENT,
  AMBER_MUTED_3,
  AMBER_MUTED_7,
  AMBER_SOFT_4,
  BORDER_4,
  CARD_BG_9,
  HERO_DARK,
  MUTED_10,
  MUTED_11,
  PURE_WHITE,
  RADIUS_CARD_SM,
  RADIUS_INPUT,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SHADOW_SOFT,
  SPACING_INLINE,
  SPACING_LIST,
  SPACING_MICRO,
  SPACING_TIGHT,
  TEXT_ON_DARK,
} from "@/lib/design-tokens";
import { CostBadge } from "@/components/cost-badge";
import { LazyPhoto } from "@/components/lazy-photo";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { useAppTheme } from "@/components/use-app-theme";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { CollectableItem } from "@/lib/types";
import { FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD } from "@/lib/fonts";

// `style` is forwarded to the outer Pressable (additive — no behavior change
// for callers that omit it) so layout-only wrappers like the masonry cell's
// `flex: 1` View can collapse into a prop: one less node per cell × hundreds
// of cells is measurable RN bridge / Yoga layout savings on long collections.
//
// The forwarded style MUST be merged with `StyleSheet.flatten`, never left as a
// raw array, because this Pressable is the child of `<Link asChild>`: expo-router
// renders that through Radix's `Slot`, which merges the two styles with a plain
// object spread (`{ ...slotStyle, ...childStyle }`). Spreading an ARRAY there
// produces `{0: …, 1: …}`, and react-native-web hands those numeric keys to the
// DOM as `node.style[0] = …` — "Failed to set an indexed property [0] on
// 'CSSStyleDeclaration'", which crashed the whole web build to the error screen.
// See `__tests__/link-aschild-style-flatten.test.ts` for the regression guard.
type ItemCardProps = { item: CollectableItem; compact?: boolean; style?: StyleProp<ViewStyle> };

/**
 * The card reads as a collectable trading card: an outer "card stock" border,
 * an inner amber frame, a name bar with the value where a trading card prints
 * its HP, a framed art window, a type band (condition + provenance), flavour
 * text, and a footer carrying the tags and a short card number derived from the
 * item id.
 *
 * The art window is its own Pressable nested inside the `<Link asChild>` child:
 * tapping the art opens the fullscreen gallery, tapping anywhere else still
 * navigates to the item screen. On web the link is a real `<a>`, so the art
 * handler has to cancel the click before it navigates — hence the
 * preventDefault/stopPropagation in `openGallery` (both are no-ops on native,
 * where the nested Pressable already wins the responder negotiation).
 */
// VM-F: memoized like SelectableItemRow — the named-function form keeps the
// component name visible in React DevTools' profiler tree. Context consumers
// (i18n/theme/collections) still re-render the card on context changes;
// memo skips only parent-driven re-renders with referentially stable props.
export const ItemCard = memo(function ItemCard({ item, compact, style }: ItemCardProps) {
  const { t } = useI18n();
  const theme = useAppTheme();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const hasPhoto = item.photos.length > 0 && Boolean(item.photos[0]);
  const photoCount = item.photos.filter(Boolean).length;

  const openGallery = useCallback((e?: GestureResponderEvent) => {
    const domEvent = e as unknown as
      | { preventDefault?: () => void; stopPropagation?: () => void }
      | undefined;
    domEvent?.preventDefault?.();
    domEvent?.stopPropagation?.();
    setGalleryOpen(true);
  }, []);
  const closeGallery = useCallback(() => setGalleryOpen(false), []);

  const conditionLabel = item.condition
    ? t(
        `condition${item.condition[0].toUpperCase()}${item.condition.slice(1)}` as
          | "conditionNew"
          | "conditionExcellent"
          | "conditionGood"
          | "conditionFair",
      )
    : null;

  // Trading cards print a set number; the item id's first 6 chars give a stable
  // per-item token that reads the same way without inventing new state.
  const cardNumber = item.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();

  const gallery = hasPhoto ? (
    <PhotoLightbox
      photos={item.photos.filter(Boolean)}
      visible={galleryOpen}
      onClose={closeGallery}
    />
  ) : null;

  if (compact) {
    return (
      <>
        <Link href={`/item/${item.id}`} asChild>
          <Pressable style={StyleSheet.flatten([styles.compactCard, { backgroundColor: theme.card, borderColor: theme.border }, style])}>
            <Pressable
              style={styles.compactArtFrame}
              onPress={hasPhoto ? openGallery : undefined}
              disabled={!hasPhoto}
              accessibilityRole="imagebutton"
              accessibilityLabel={
                photoCount > 1 ? t("galleryOpenPhotos", { count: photoCount }) : t("galleryOpen")
              }
            >
              {hasPhoto ? (
                <LazyPhoto
                  uri={withCloudinaryThumbUrl(item.photos[0], { width: 480, height: 360, mode: "fill" })}
                  style={styles.compactImage}
                  fallbackColor={placeholderColor(item.id)}
                />
              ) : (
                <View style={[styles.compactImage, { backgroundColor: placeholderColor(item.id) }]} />
              )}
              {photoCount > 1 ? (
                <View
                  style={styles.photoCountBadge}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  aria-hidden
                >
                  <Ionicons name="images-outline" size={10} color={TEXT_ON_DARK} />
                  <Text style={styles.photoCountText}>{photoCount}</Text>
                </View>
              ) : null}
            </Pressable>
            <Text style={{ ...styles.compactTitle, color: theme.text }} numberOfLines={2}>{item.title}</Text>
            {/* Fixed-height slot: <CostBadge> renders null for cost-less items,
                which would collapse the card's gap AND shrink the card — the
                wrapper keeps the compact card's height deterministic so the
                viewer FlatList's getItemLayout geometry holds for every row. */}
            <View style={styles.compactCostSlot}>
              <CostBadge item={item} withLabel style={{ ...styles.compactCost, color: theme.meta }} />
            </View>
          </Pressable>
        </Link>
        {gallery}
      </>
    );
  }

  return (
    <>
      <Link href={`/item/${item.id}`} asChild>
        <Pressable style={StyleSheet.flatten([styles.card, { backgroundColor: theme.card, borderColor: theme.border }, SHADOW_SOFT, style])}>
          <View style={styles.frame}>
            <View style={styles.nameBar}>
              <Text style={{ ...styles.name, color: theme.text }} numberOfLines={1}>{item.title}</Text>
              <CostBadge item={item} style={styles.hp} />
            </View>

            <Pressable
              style={styles.artWindow}
              onPress={hasPhoto ? openGallery : undefined}
              disabled={!hasPhoto}
              accessibilityRole="imagebutton"
              accessibilityLabel={
                photoCount > 1 ? t("galleryOpenPhotos", { count: photoCount }) : t("galleryOpen")
              }
            >
              {hasPhoto ? (
                <LazyPhoto
                  uri={withCloudinaryThumbUrl(item.photos[0], { width: 640, height: 480, mode: "fill" })}
                  style={styles.art}
                  fallbackColor={placeholderColor(item.id)}
                />
              ) : (
                <View style={{ ...styles.art, backgroundColor: placeholderColor(item.id) }} />
              )}
              {photoCount > 1 ? (
                <View
                  style={styles.photoCountBadge}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  aria-hidden
                >
                  <Ionicons name="images-outline" size={11} color={TEXT_ON_DARK} />
                  <Text style={styles.photoCountText}>{photoCount}</Text>
                </View>
              ) : null}
            </Pressable>

            <View style={styles.typeBand}>
              {conditionLabel ? (
                <View style={styles.conditionBadge}>
                  <Text style={styles.conditionBadgeText}>{conditionLabel}</Text>
                </View>
              ) : null}
              {item.acquiredFrom ? (
                <Text style={styles.typeBandMeta} numberOfLines={1}>{item.acquiredFrom}</Text>
              ) : null}
            </View>

            {item.description ? (
              <View style={styles.flavorBox}>
                <Text style={styles.flavorText} numberOfLines={2}>{item.description}</Text>
              </View>
            ) : null}

            {item.tags && item.tags.length > 0 ? (
              <View style={styles.tagsRow}>
                {item.tags.map((tag, i) => (
                  <View key={i} style={{ ...styles.tagBadge, backgroundColor: tag.color }}>
                    <Text style={styles.tagBadgeText}>{tag.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.footerRow}>
              <Text style={styles.footerMeta}>{t("photosCount", { count: item.photos.length })}</Text>
              <Text style={styles.footerMeta}>№ {cardNumber}</Text>
            </View>
          </View>
        </Pressable>
      </Link>
      {gallery}
    </>
  );
});

/**
 * A trading card's printed shape. The card never renders larger than this even
 * on a desktop-width column; below it, the 3:4 ratio scales it down to whatever
 * grid cell it is dropped into.
 */
export const CARD_MAX_WIDTH = 600;
export const CARD_MAX_HEIGHT = 800;
export const CARD_ASPECT_RATIO = CARD_MAX_WIDTH / CARD_MAX_HEIGHT;

const styles = StyleSheet.create({
  // Outer "card stock": the theme-coloured border the rest of the app uses,
  // with the amber frame nested inside for the double-border trading-card look.
  //
  // A printed card has a fixed shape, so this one does too: portrait 3:4,
  // capped at CARD_MAX_WIDTH × CARD_MAX_HEIGHT and centred in whatever column
  // it lands in. Below the cap it scales down with the column instead of
  // growing to fill a wide screen — an item with a long description and one
  // with none render the same silhouette, which is what makes a wall of them
  // scan as a set.
  card: {
    width: "100%",
    maxWidth: CARD_MAX_WIDTH,
    maxHeight: CARD_MAX_HEIGHT,
    aspectRatio: CARD_ASPECT_RATIO,
    alignSelf: "center",
    borderRadius: RADIUS_ITEM_AIRY,
    padding: SPACING_TIGHT,
    borderWidth: 1,
  },
  frame: {
    flex: 1,
    borderRadius: RADIUS_CARD_SM,
    borderWidth: 2,
    borderColor: AMBER_MUTED_7,
    backgroundColor: CARD_BG_9,
    padding: SPACING_INLINE,
    gap: SPACING_INLINE,
  },
  nameBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING_INLINE,
  },
  name: {
    flex: 1,
    fontSize: 19,
    fontWeight: "700",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  // Where a trading card prints its HP.
  hp: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
    color: MUTED_10,
  },
  // The art window is the card's elastic block: every other row is
  // content-sized, so the artwork absorbs whatever height the fixed aspect
  // ratio leaves over. That keeps the frame full whether the item has tags,
  // a description, both or neither.
  artWindow: {
    flex: 1,
    minHeight: 96,
    borderRadius: RADIUS_INPUT,
    borderWidth: 2,
    borderColor: AMBER_ACCENT,
    overflow: "hidden",
    backgroundColor: AMBER_MUTED_3,
  },
  art: {
    width: "100%",
    height: "100%",
    backgroundColor: AMBER_MUTED_3,
  },
  photoCountBadge: {
    position: "absolute",
    right: SPACING_TIGHT,
    bottom: SPACING_TIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_MICRO,
    paddingVertical: 2,
    paddingHorizontal: SPACING_TIGHT,
    borderRadius: RADIUS_PILL,
    backgroundColor: HERO_DARK,
  },
  photoCountText: {
    color: TEXT_ON_DARK,
    fontSize: 10,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  typeBand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING_INLINE,
    minHeight: 22,
  },
  typeBandMeta: {
    flex: 1,
    textAlign: "right",
    fontSize: 12,
    fontWeight: "600",
    color: MUTED_11,
    fontFamily: FONT_BODY_SEMIBOLD,
  },
  // Flavour text — the italicised description box near the bottom of a card.
  flavorBox: {
    borderRadius: RADIUS_INPUT,
    borderWidth: 1,
    borderColor: BORDER_4,
    backgroundColor: AMBER_SOFT_4,
    paddingVertical: SPACING_TIGHT,
    paddingHorizontal: SPACING_INLINE,
  },
  flavorText: {
    fontSize: 13,
    lineHeight: 19,
    fontStyle: "italic",
    color: MUTED_10,
    fontFamily: FONT_BODY,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING_MICRO,
  },
  tagBadge: {
    borderRadius: RADIUS_PILL,
    paddingVertical: 2,
    paddingHorizontal: SPACING_INLINE,
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
    paddingHorizontal: SPACING_LIST,
    backgroundColor: HERO_DARK,
  },
  conditionBadgeText: {
    color: TEXT_ON_DARK,
    fontSize: 11,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING_INLINE,
    borderTopWidth: 1,
    borderTopColor: BORDER_4,
    paddingTop: SPACING_TIGHT,
  },
  footerMeta: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED_11,
    fontFamily: FONT_BODY_BOLD,
  },
  // Compact = the same trading-card language at masonry scale: amber-framed art
  // window on top, name block, then the value slot. Geometry stays deterministic
  // for the viewer FlatList's getItemLayout (see COMPACT_ITEM_CARD_HEIGHT).
  compactCard: {
    borderRadius: RADIUS_INPUT,
    borderWidth: 2,
    overflow: "hidden",
    gap: SPACING_TIGHT,
    padding: SPACING_TIGHT,
  },
  compactArtFrame: {
    borderRadius: RADIUS_INPUT,
    borderWidth: 1,
    borderColor: AMBER_ACCENT,
    overflow: "hidden",
  },
  compactImage: {
    width: "100%",
    height: 104,
    backgroundColor: AMBER_MUTED_3,
  },
  compactTitle: {
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 2,
    fontFamily: FONT_DISPLAY_EDITORIAL,
    // Deterministic geometry for getItemLayout: the title always occupies
    // exactly two lines' worth of height (numberOfLines={2} caps the top,
    // minHeight reserves the bottom), so a 1-line title can't shrink the
    // card. lineHeight is explicit because RN's per-platform default would
    // make the reserved block's height platform-dependent.
    lineHeight: 18,
    minHeight: 36,
  },
  compactCost: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 2,
    fontFamily: FONT_BODY_SEMIBOLD,
    lineHeight: 16,
  },
  // Reserved slot for <CostBadge> — fixed height whether or not the badge
  // renders (see the JSX comment). Height matches compactCost.lineHeight.
  compactCostSlot: {
    height: 16,
  },
});

/**
 * Fixed rendered height of the compact card, used by the viewer FlatList's
 * `getItemLayout` in `app/collection/[id].tsx`. Derivation (top to bottom,
 * all values from the styles above — update BOTH when the layout changes):
 *   2  borderWidth (top)
 *   6  padding (top, SPACING_TIGHT)
 * 106  compactArtFrame (1 border + 104 image + 1 border)
 *   6  gap (SPACING_TIGHT)
 *  36  compactTitle reserved 2-line block (minHeight)
 *   6  gap (SPACING_TIGHT)
 *  16  compactCostSlot height
 *   6  padding (bottom, SPACING_TIGHT)
 *   2  borderWidth (bottom)
 * = 186
 */
export const COMPACT_ITEM_CARD_HEIGHT = 186;
