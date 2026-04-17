import { Stack } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/screen";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";

type MonthBucket = { label: string; count: number };

export default function StatsScreen() {
  const { collections, items, refresh } = useCollections();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  }, [refresh]);

  const ownedCollections = collections.filter((c) => c.role === "owner");
  const ownedItems = useMemo(
    () => items.filter((i) => !i.isWishlist && ownedCollections.some((c) => c.id === i.collectionId)),
    [items, ownedCollections],
  );

  const totalValue = useMemo(
    () => ownedItems.reduce((sum, i) => sum + (typeof i.cost === "number" ? i.cost : 0), 0),
    [ownedItems],
  );

  const growth = useMemo<MonthBucket[]>(() => {
    const buckets = new Map<string, number>();
    for (const item of ownedItems) {
      const date = item.createdAt ? new Date(item.createdAt) : null;
      if (!date || isNaN(date.getTime())) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([label, count]) => ({ label, count }));
  }, [ownedItems]);

  const maxCount = Math.max(...growth.map((b) => b.count), 1);

  return (
    <Screen refreshing={refreshing} onRefresh={handleRefresh}>
      <Stack.Screen options={{ title: t("statsTitle") }} />

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{t("statsTitle")}</Text>
        <Text style={styles.heroText}>{t("statsSubtitle")}</Text>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNumber}>{ownedItems.length}</Text>
          <Text style={styles.summaryLabel}>{t("statsTotalItems")}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNumber}>{totalValue > 0 ? totalValue.toLocaleString() : "—"}</Text>
          <Text style={styles.summaryLabel}>{t("statsTotalValue")}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNumber}>{ownedCollections.length}</Text>
          <Text style={styles.summaryLabel}>{t("statsTotalCollections")}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("statsGrowthTitle")}</Text>
        {growth.length === 0 ? (
          <Text style={styles.emptyText}>{t("statsNoData")}</Text>
        ) : (
          <View style={styles.chart}>
            {growth.map((bucket) => (
              <View key={bucket.label} style={styles.barColumn}>
                <Text style={styles.barCount}>{bucket.count}</Text>
                <View style={styles.barTrack}>
                  <View
                    style={{
                      ...styles.barFill,
                      height: `${Math.max((bucket.count / maxCount) * 100, 4)}%`,
                    }}
                  />
                </View>
                <Text style={styles.barLabel}>{bucket.label.slice(5)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: "#261b14",
    borderRadius: 28,
    padding: 20,
    gap: 8,
  },
  heroTitle: {
    fontSize: 28,
    color: "#fff7ef",
    fontWeight: "800",
  },
  heroText: {
    color: "#dfc8b2",
    lineHeight: 22,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 24,
    padding: 16,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    gap: 6,
    alignItems: "center",
  },
  summaryNumber: {
    fontSize: 26,
    fontWeight: "800",
    color: "#2d2117",
  },
  summaryLabel: {
    color: "#715d4d",
    fontSize: 12,
    textAlign: "center",
    fontWeight: "600",
  },
  section: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#2f2318",
  },
  emptyText: {
    color: "#6b5647",
    lineHeight: 22,
    textAlign: "center",
    paddingVertical: 20,
  },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    height: 180,
    borderRadius: 24,
    padding: 16,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  barColumn: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  barCount: {
    color: "#8f6947",
    fontSize: 11,
    fontWeight: "700",
  },
  barTrack: {
    flex: 1,
    width: "100%",
    maxWidth: 32,
    borderRadius: 8,
    backgroundColor: "#f0e4d0",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    borderRadius: 8,
    backgroundColor: "#d89c5b",
  },
  barLabel: {
    color: "#8f6947",
    fontSize: 10,
    fontWeight: "700",
  },
});
