import { Link } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { Collection } from "@/lib/types";

export function CollectionCard({ collection, count }: { collection: Collection; count: number }) {
  const { t } = useI18n();
  const hasCover = Boolean(collection.coverPhoto);

  return (
    <Link href={`/collection/${collection.id}`} asChild>
      <Pressable style={{...styles.card, ...(!hasCover ? { backgroundColor: placeholderColor(collection.id) } : {})}}>
        {hasCover ? <Image source={{ uri: collection.coverPhoto }} style={styles.image} /> : null}
        <View style={styles.overlay} />
        <View style={styles.content}>
          <View style={styles.topRow}>
            <Text style={styles.role}>{collection.role === "owner" ? t("yourCollection") : t("sharedToYou")}</Text>
            <Text style={styles.count}>{t("itemsCount", { count })}</Text>
          </View>
          <Text style={styles.title}>{collection.name}</Text>
          <Text style={styles.description}>{collection.description}</Text>
          <Text style={styles.meta}>
            {collection.role === "owner"
              ? t("sharedWithPeople", { count: collection.sharedWith.length })
              : t("ownerLabel", { name: collection.ownerName })}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 220,
    borderRadius: 28,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: "#c8b8a4",
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(34, 24, 17, 0.36)",
  },
  content: {
    padding: 20,
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  role: {
    color: "#fff1de",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  count: {
    color: "#f5ebdf",
    fontSize: 13,
    fontWeight: "600",
  },
  title: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "800",
  },
  description: {
    color: "#f3eee7",
    fontSize: 15,
    lineHeight: 22,
  },
  meta: {
    color: "#f8dfc5",
    fontSize: 14,
    fontWeight: "600",
  },
});
