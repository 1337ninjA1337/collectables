import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { Animated, DimensionValue, Easing, StyleProp, StyleSheet, View, ViewStyle } from "react-native";

type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

const BASE_COLOR = "#ead8c3";
const HIGHLIGHT = "rgba(255, 250, 244, 0.9)";

export function Skeleton({ width = "100%", height = 16, borderRadius = 8, style }: SkeletonProps) {
  const anim = useRef(new Animated.Value(0)).current;
  const [boxWidth, setBoxWidth] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1300,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-Math.max(boxWidth, 120), Math.max(boxWidth, 120)],
  });

  return (
    <View
      style={[
        { width, height, borderRadius, backgroundColor: BASE_COLOR, overflow: "hidden" },
        style,
      ]}
      onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}
      >
        <LinearGradient
          colors={["transparent", HIGHLIGHT, "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

export function SkeletonProfileCard() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Skeleton width={64} height={64} borderRadius={32} />
        <View style={styles.meta}>
          <Skeleton width="60%" height={18} />
          <Skeleton width="40%" height={14} style={{ marginTop: 8 }} />
          <Skeleton width="90%" height={12} style={{ marginTop: 10 }} />
          <Skeleton width="75%" height={12} style={{ marginTop: 6 }} />
        </View>
      </View>
      <View style={styles.actions}>
        <Skeleton width={120} height={36} borderRadius={18} />
        <Skeleton width={100} height={36} borderRadius={18} />
      </View>
    </View>
  );
}

export function SkeletonProfileList({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: 14 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonProfileCard key={i} />
      ))}
    </View>
  );
}

export function SkeletonCollectionDetail() {
  return (
    <View style={{ gap: 18 }}>
      <Skeleton height={220} borderRadius={24} />
      <View style={styles.card}>
        <Skeleton width="70%" height={24} />
        <Skeleton width="40%" height={14} style={{ marginTop: 10 }} />
        <Skeleton width="95%" height={12} style={{ marginTop: 14 }} />
        <Skeleton width="85%" height={12} style={{ marginTop: 6 }} />
      </View>
      <View style={{ gap: 12 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i} style={styles.card}>
            <View style={styles.row}>
              <Skeleton width={72} height={72} borderRadius={14} />
              <View style={styles.meta}>
                <Skeleton width="70%" height={18} />
                <Skeleton width="45%" height={14} style={{ marginTop: 8 }} />
                <Skeleton width="55%" height={12} style={{ marginTop: 8 }} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function SkeletonItemDetail() {
  return (
    <View style={{ gap: 18 }}>
      <Skeleton height={260} borderRadius={24} />
      <View style={styles.card}>
        <Skeleton width="80%" height={26} />
        <Skeleton width="50%" height={14} style={{ marginTop: 12 }} />
        <Skeleton width="95%" height={12} style={{ marginTop: 16 }} />
        <Skeleton width="90%" height={12} style={{ marginTop: 6 }} />
        <Skeleton width="60%" height={12} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

export function SkeletonProfile() {
  return (
    <View style={{ gap: 18 }}>
      <View style={[styles.card, { alignItems: "center" }]}>
        <Skeleton width={120} height={120} borderRadius={60} />
        <Skeleton width="55%" height={22} style={{ marginTop: 16 }} />
        <Skeleton width="35%" height={14} style={{ marginTop: 8 }} />
        <Skeleton width="90%" height={12} style={{ marginTop: 14 }} />
        <Skeleton width="80%" height={12} style={{ marginTop: 6 }} />
      </View>
      <View style={{ gap: 12 }}>
        {Array.from({ length: 2 }).map((_, i) => (
          <View key={i} style={styles.card}>
            <Skeleton width="65%" height={18} />
            <Skeleton width="40%" height={12} style={{ marginTop: 10 }} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fffaf4",
    borderRadius: 20,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: "#f0e2cf",
  },
  row: {
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
  },
  meta: {
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
});
