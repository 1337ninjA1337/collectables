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

  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const animatingRef = useRef(false);

  const activeRef = useRef(active);
  const tabsRef = useRef(tabs);
  const onChangeRef = useRef(onChange);
  activeRef.current = active;
  tabsRef.current = tabs;
  onChangeRef.current = onChange;

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

  function commitTo(targetKey: string, direction: "next" | "prev") {
    const w = widthRef.current;
    if (!w) {
      onChangeRef.current(targetKey);
      return;
    }
    animatingRef.current = true;
    Animated.timing(translateX, {
      toValue: direction === "next" ? -w : w,
      duration: ANIM_DURATION,
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
          commitTo(t[idx + 1].key, "next");
        } else if (shouldPrev) {
          commitTo(t[idx - 1].key, "prev");
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            speed: 20,
            bounciness: 4,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: false,
          speed: 20,
          bounciness: 4,
        }).start();
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
      <Text style={variant === "sub" ? styles.subHeaderLabel : styles.headerLabel}>
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
                  : styles.dotActive
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
                style={{ ...styles.subTab, ...(isActive ? styles.subTabActive : {}) }}
                onPress={() => jumpToKey(t.key)}
              >
                <Text
                  style={{ ...styles.subTabText, ...(isActive ? styles.subTabTextActive : {}) }}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          }
          return (
            <Pressable
              key={t.key}
              style={{ ...styles.tab, ...(isActive ? styles.tabActive : {}) }}
              onPress={() => jumpToKey(t.key)}
            >
              <Text style={{ ...styles.tabText, ...(isActive ? styles.tabTextActive : {}) }}>
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
    color: "#2f2318",
    flex: 1,
  },
  subHeaderLabel: {
    fontSize: 16,
    fontWeight: "800",
    color: "#5f4734",
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
    backgroundColor: "#e4c29a",
  },
  dotActive: {
    backgroundColor: "#261b14",
    width: 22,
  },
  subDotActive: {
    backgroundColor: "#d89c5b",
    width: 18,
  },
  dotHighlight: {
    borderWidth: 2,
    borderColor: "#d92f2f",
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
  },
  tabActive: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  tabText: {
    color: "#5f4734",
    fontWeight: "800",
    fontSize: 14,
    textAlign: "center",
  },
  tabTextActive: {
    color: "#fff4e8",
  },
  subTabRow: {
    flexDirection: "row",
    gap: 8,
  },
  subTab: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  subTabActive: {
    backgroundColor: "#d89c5b",
    borderColor: "#d89c5b",
  },
  subTabText: {
    color: "#6b5543",
    fontWeight: "700",
    fontSize: 14,
  },
  subTabTextActive: {
    color: "#241912",
  },
});
