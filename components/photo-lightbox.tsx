import { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import {
  AMBER_ACCENT,
  HERO_DARK_9,
  RADIUS_PILL,
  SPACING_INLINE,
  SPACING_LIST,
  SPACING_TIGHT,
  TEXT_ON_DARK,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { FONT_BODY_BOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";

/**
 * Fullscreen photo gallery.
 *
 * Opened from any photo surface that owns more than a thumbnail (the item
 * card's art window, the item-detail hero). Photos page horizontally one
 * viewport at a time; the counter + dots + chevrons only render for a
 * multi-photo item, so a single-photo item gets a plain zoomed view with a
 * close button and nothing else.
 *
 * The paging ScrollView is measured off `useWindowDimensions()` rather than the
 * imperative Dimensions module, so a web resize / device rotation re-lays-out
 * instead of freezing the page width at mount. `pagingEnabled` snaps to it, and
 * `onMomentumScrollEnd` is the only index writer — a mid-drag `onScroll` would
 * flicker the counter between two pages while the finger is still down.
 */
export type PhotoLightboxProps = {
  photos: string[];
  visible: boolean;
  onClose: () => void;
  /** Photo to land on when the gallery opens. Clamped into range. */
  initialIndex?: number;
};

export function PhotoLightbox({ photos, visible, onClose, initialIndex = 0 }: PhotoLightboxProps) {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const clampedInitial = Math.min(Math.max(initialIndex, 0), Math.max(photos.length - 1, 0));
  const [index, setIndex] = useState(clampedInitial);

  // Jump to the tapped photo when the gallery opens. The ScrollView is only
  // mounted while the Modal is visible, so the scroll has to happen after that
  // mount — an effect keyed on `visible` (not a `contentOffset` prop, which
  // react-native-web ignores on first paint).
  useEffect(() => {
    if (!visible) return;
    setIndex(clampedInitial);
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: clampedInitial * width, y: 0, animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, [visible, clampedInitial, width]);

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width <= 0) return;
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex(Math.min(Math.max(next, 0), Math.max(photos.length - 1, 0)));
    },
    [width, photos.length],
  );

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), Math.max(photos.length - 1, 0));
      setIndex(clamped);
      scrollRef.current?.scrollTo({ x: clamped * width, y: 0, animated: true });
    },
    [photos.length, width],
  );

  if (photos.length === 0) return null;

  const multi = photos.length > 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumEnd}
          style={styles.pager}
        >
          {photos.map((photo, i) => (
            <View key={`${photo}-${i}`} style={{ width, height }}>
              <Image source={{ uri: photo }} style={styles.photo} resizeMode="contain" />
            </View>
          ))}
        </ScrollView>

        <Pressable
          style={styles.closeButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("galleryClose")}
          hitSlop={8}
        >
          <Ionicons
            name="close"
            size={22}
            color={TEXT_ON_DARK}
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
          />
        </Pressable>

        {multi ? (
          <>
            <Pressable
              style={[styles.navButton, styles.navLeft]}
              onPress={() => goTo(index - 1)}
              disabled={index === 0}
              accessibilityState={{ disabled: index === 0 }}
              accessibilityRole="button"
              accessibilityLabel={t("galleryPrevious")}
              hitSlop={8}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={index === 0 ? TEXT_ON_DARK_SOFT : TEXT_ON_DARK}
                accessibilityElementsHidden
                importantForAccessibility="no"
                aria-hidden
              />
            </Pressable>
            <Pressable
              style={[styles.navButton, styles.navRight]}
              onPress={() => goTo(index + 1)}
              disabled={index === photos.length - 1}
              accessibilityState={{ disabled: index === photos.length - 1 }}
              accessibilityRole="button"
              accessibilityLabel={t("galleryNext")}
              hitSlop={8}
            >
              <Ionicons
                name="chevron-forward"
                size={24}
                color={index === photos.length - 1 ? TEXT_ON_DARK_SOFT : TEXT_ON_DARK}
                accessibilityElementsHidden
                importantForAccessibility="no"
                aria-hidden
              />
            </Pressable>
            <View style={styles.footer} pointerEvents="none">
              <Text style={styles.counter}>
                {t("galleryCounter", { current: index + 1, total: photos.length })}
              </Text>
              <View style={styles.dots}>
                {photos.map((photo, i) => (
                  <View
                    key={`dot-${photo}-${i}`}
                    style={[styles.dot, i === index ? styles.dotActive : null]}
                  />
                ))}
              </View>
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: HERO_DARK_9,
  },
  pager: {
    flex: 1,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  closeButton: {
    position: "absolute",
    top: 44,
    right: SPACING_LIST + SPACING_TIGHT,
    width: 40,
    height: 40,
    borderRadius: RADIUS_PILL,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: HERO_DARK_9,
    borderWidth: 1,
    borderColor: AMBER_ACCENT,
  },
  navButton: {
    position: "absolute",
    top: "50%",
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: RADIUS_PILL,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: HERO_DARK_9,
    borderWidth: 1,
    borderColor: AMBER_ACCENT,
  },
  navLeft: {
    left: SPACING_TIGHT,
  },
  navRight: {
    right: SPACING_TIGHT,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 36,
    alignItems: "center",
    gap: SPACING_INLINE,
  },
  counter: {
    color: TEXT_ON_DARK,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  dots: {
    flexDirection: "row",
    gap: SPACING_TIGHT,
  },
  dot: {
    width: SPACING_TIGHT,
    height: SPACING_TIGHT,
    borderRadius: RADIUS_PILL,
    backgroundColor: TEXT_ON_DARK_SOFT,
    opacity: 0.45,
  },
  dotActive: {
    backgroundColor: AMBER_ACCENT,
    opacity: 1,
    width: SPACING_INLINE + SPACING_LIST,
  },
});
