import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  Animated,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AMBER_ACCENT,
  AMBER_SOFT,
  DANGER,
  RADIUS_PILL,
  SPACING_INLINE,
  TEXT_DARK_2,
} from "@/lib/design-tokens";
import { useAppTheme } from "@/components/use-app-theme";
import { useI18n } from "@/lib/i18n-context";
import { motionDuration, useReducedMotionRef } from "@/lib/reduced-motion";
import { announceTabChange } from "@/lib/tab-announcement";
import { useLatestRef } from "@/lib/use-latest-ref";

export type SwipeTab = { key: string; label: string };

type Props = {
  tabs: SwipeTab[];
  active: string;
  onChange: (key: string) => void;
  variant?: "main" | "sub";
  renderTab: (key: string) => ReactNode;
  /** Key of the tab whose indicator dot should be outlined red (e.g. for incoming requests). */
  dotHighlight?: string;
};

const ANIM_DURATION = 220;

export function SwipeTabs({ tabs, active, onChange, variant = "main", renderTab, dotHighlight }: Props) {
  const isNative = Platform.OS !== "web";
  const theme = useAppTheme();
  const { t: translate } = useI18n();

  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const animatingRef = useRef(false);

  // Read through a ref, not a closure: the PanResponder below is built inside
  // `useRef(...).current` and never rebuilt, so a captured `reduced` would be
  // the value from the first render for the life of the component.
  const reducedMotion = useReducedMotionRef();

  const activeRef = useLatestRef(active);
  const tabsRef = useLatestRef(tabs);
  const onChangeRef = useLatestRef(onChange);
  // For the same reason as the three above and as `useReducedMotionRef`: the
  // PanResponder is built inside `useRef(...).current` and never rebuilt, so a
  // `translate` captured there is the one from the first render — the
  // announcement would keep speaking the language the app was started in after
  // the user changed it.
  const translateRef = useLatestRef(translate);

  function handleLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== widthRef.current) {
      widthRef.current = w;
      setWidth(w);
    }
  }

  // Whenever `active` changes (via swipe commit, click, or external change),
  // snap the pager back to its resting position (translateX = 0).
  // useLayoutEffect runs after React commits the new slot contents but before
  // paint, so transform and slot layout update atomically — no flicker.
  useLayoutEffect(() => {
    translateX.stopAnimation();
    translateX.setValue(0);
    animatingRef.current = false;
  }, [active, translateX]);

  /**
   * Back to rest after a swipe that did not commit.
   *
   * Nothing waits on this one, so under reduced motion the instant equivalent
   * is the value itself — a zero-duration spring is still a spring, and
   * `setValue` is what "no animation" actually means.
   */
  function settleBack() {
    if (reducedMotion.current) {
      translateX.setValue(0);
      return;
    }
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: false,
      speed: 20,
      bounciness: 4,
    }).start();
  }

  /**
   * The tab a swipe landed on, said out loud — or nothing.
   *
   * Reads the tab list and the translator through their refs because every
   * caller is inside the PanResponder, which captured the first render.
   * `lib/tab-announcement.ts` owns the decision not to speak: a key that is not
   * in the list resolves to `-1` here and is refused there rather than read
   * aloud as a position.
   */
  function speakTab(targetKey: string) {
    const list = tabsRef.current;
    const index = list.findIndex((x) => x.key === targetKey);
    announceTabChange(translateRef.current, list[index]?.label ?? "", index, list.length);
  }

  /**
   * `spoken` is the GESTURE, not the commit.
   *
   * On native there are no tab buttons — the header is a label and a row of
   * dots, and the swipe is the only way to change tab — so nothing tells a
   * screen-reader user it happened. On web the same component renders
   * `<Pressable>`s with `accessibilityState={{ selected }}`, which the platform
   * announces on press — so this defaults to silent and only the two pan
   * release call sites opt in, rather than the other way round: a third caller
   * added later is quiet until somebody decides it should not be.
   */
  function commitTo(targetKey: string, direction: "next" | "prev", spoken = false) {
    const w = widthRef.current;
    if (!w) {
      onChangeRef.current(targetKey);
      if (spoken) speakTab(targetKey);
      return;
    }
    animatingRef.current = true;
    // Zero rather than skipped: the completion callback below is what changes
    // the tab, so the animation must still RUN — it just finishes on the next
    // frame instead of over ANIM_DURATION.
    Animated.timing(translateX, {
      toValue: direction === "next" ? -w : w,
      duration: motionDuration(ANIM_DURATION, reducedMotion.current),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) {
        animatingRef.current = false;
        return;
      }
      // Trigger the active change. useLayoutEffect will snap translateX back
      // to 0 *after* React commits the new slot contents, so transform and
      // slot layout change atomically.
      onChangeRef.current(targetKey);
      // After the change, not before it: the `!finished` branch above returns
      // without changing anything, and a sentence spoken for a gesture the
      // pager then abandoned is a lie the listener cannot check.
      if (spoken) speakTab(targetKey);
    });
  }

  function jumpToKey(targetKey: string) {
    if (animatingRef.current) return;
    const t = tabsRef.current;
    const curIdx = t.findIndex((x) => x.key === activeRef.current);
    const newIdx = t.findIndex((x) => x.key === targetKey);
    if (newIdx === -1 || newIdx === curIdx) return;

    if (newIdx === curIdx + 1) {
      commitTo(targetKey, "next");
    } else if (newIdx === curIdx - 1) {
      commitTo(targetKey, "prev");
    } else {
      // Non-adjacent: just switch without slide
      onChangeRef.current(targetKey);
    }
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !animatingRef.current &&
        Math.abs(g.dx) > 12 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (animatingRef.current) return;
        const w = widthRef.current;
        if (!w) return;
        const t = tabsRef.current;
        const idx = t.findIndex((x) => x.key === activeRef.current);
        let dx = g.dx;
        // Rubber band at edges
        if ((idx === 0 && dx > 0) || (idx === t.length - 1 && dx < 0)) {
          dx = dx / 3;
        }
        translateX.setValue(dx);
      },
      onPanResponderRelease: (_, g) => {
        if (animatingRef.current) return;
        const w = widthRef.current;
        if (!w) return;
        const t = tabsRef.current;
        const idx = t.findIndex((x) => x.key === activeRef.current);
        const threshold = Math.max(50, w * 0.2);
        const fast = Math.abs(g.vx) > 0.4;

        const shouldNext = (g.dx < -threshold || (fast && g.vx < 0)) && idx < t.length - 1;
        const shouldPrev = (g.dx > threshold || (fast && g.vx > 0)) && idx > 0;

        if (shouldNext) {
          commitTo(t[idx + 1].key, "next", true);
        } else if (shouldPrev) {
          commitTo(t[idx - 1].key, "prev", true);
        } else {
          settleBack();
        }
      },
      onPanResponderTerminate: () => {
        settleBack();
      },
    }),
  ).current;

  const activeIndex = Math.max(0, tabs.findIndex((x) => x.key === active));
  const activeLabel = tabs[activeIndex]?.label ?? "";
  const prevKey = activeIndex > 0 ? tabs[activeIndex - 1].key : null;
  const nextKey = activeIndex < tabs.length - 1 ? tabs[activeIndex + 1].key : null;

  // Active panel is rendered in-flow so the container's height tracks it.
  // Prev/next are absolutely positioned off-screen to the sides and share
  // the same translateX, so they're not counted in the container's layout
  // height — each tab scrolls independently based on its own content.
  const pager = (
    <View style={styles.clip} onLayout={handleLayout}>
      <Animated.View style={{ transform: [{ translateX }] }}>
        {renderTab(active)}
      </Animated.View>
      {width > 0 && prevKey ? (
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            right: "100%",
            width,
            transform: [{ translateX }],
          }}
        >
          {renderTab(prevKey)}
        </Animated.View>
      ) : null}
      {width > 0 && nextKey ? (
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            left: "100%",
            width,
            transform: [{ translateX }],
          }}
        >
          {renderTab(nextKey)}
        </Animated.View>
      ) : null}
    </View>
  );

  const header = (
    <View style={styles.header}>
      <Text
        style={{
          ...(variant === "sub" ? styles.subHeaderLabel : styles.headerLabel),
          color: variant === "sub" ? theme.muted : theme.text,
        }}
      >
        {activeLabel}
      </Text>
      <View style={styles.dots}>
        {tabs.map((t, i) => (
          <View
            key={t.key}
            style={{
              ...styles.dot,
              ...(i === activeIndex
                ? variant === "sub"
                  ? styles.subDotActive
                  : { ...styles.dotActive, backgroundColor: theme.text }
                : {}),
              ...(dotHighlight === t.key ? styles.dotHighlight : {}),
            }}
          />
        ))}
      </View>
    </View>
  );

  if (isNative) {
    return (
      <View style={styles.wrap} {...panResponder.panHandlers}>
        {header}
        {pager}
      </View>
    );
  }

  return (
    <View style={styles.wrap} {...panResponder.panHandlers}>
      <View style={variant === "sub" ? styles.subTabRow : styles.tabRow}>
        {tabs.map((t) => {
          const isActive = t.key === active;
          if (variant === "sub") {
            return (
              <Pressable
                key={t.key}
                style={{
                  ...styles.subTab,
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  ...(isActive ? styles.subTabActive : {}),
                }}
                onPress={() => jumpToKey(t.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text
                  style={{
                    ...styles.subTabText,
                    color: isActive ? TEXT_DARK_2 : theme.muted,
                  }}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          }
          return (
            <Pressable
              key={t.key}
              style={{
                ...styles.tab,
                backgroundColor: theme.cardElevated,
                borderColor: AMBER_SOFT,
                ...(isActive ? { backgroundColor: theme.text, borderColor: theme.text } : {}),
              }}
              onPress={() => jumpToKey(t.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={{
                  ...styles.tabText,
                  color: isActive ? theme.page : theme.muted,
                }}
                numberOfLines={2}
                adjustsFontSizeToFit
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {pager}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
  },
  clip: {
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  headerLabel: {
    fontSize: 20,
    fontWeight: "800",
    flex: 1,
  },
  subHeaderLabel: {
    fontSize: 16,
    fontWeight: "800",
    flex: 1,
  },
  dots: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AMBER_SOFT,
  },
  dotActive: {
    width: 22,
  },
  subDotActive: {
    backgroundColor: AMBER_ACCENT,
    width: 18,
  },
  dotHighlight: {
    borderWidth: 2,
    borderColor: DANGER,
  },
  tabRow: {
    flexDirection: "row",
    gap: SPACING_INLINE,
  },
  tab: {
    flex: 1,
    // Allow the flex item to shrink below its content's intrinsic width so a
    // long unbreakable label (e.g. ru "Отслеживаемые") can't push the row
    // past the screen edge. Pairs with numberOfLines/adjustsFontSizeToFit.
    minWidth: 0,
    borderRadius: RADIUS_PILL,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
  },
  tabText: {
    fontWeight: "800",
    fontSize: 14,
    textAlign: "center",
  },
  subTabRow: {
    flexDirection: "row",
    gap: SPACING_INLINE,
  },
  subTab: {
    flex: 1,
    minWidth: 0,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
  },
  subTabActive: {
    backgroundColor: AMBER_ACCENT,
    borderColor: AMBER_ACCENT,
  },
  subTabText: {
    fontWeight: "700",
    fontSize: 14,
  },
});
