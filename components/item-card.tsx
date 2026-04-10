import { Link } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { CollectableItem } from "@/lib/types";

export function ItemCard({ item }: { item: CollectableItem }) {
  const { t } = useI18n();
  const hasPhoto = item.photos.length > 0 && Boolean(item.photos[0]);

  return (
    <Link href={`/item/${item.id}`} asChild>
      <Pressable style={styles.card}>
        {hasPhoto ? (
          <Image source={{ uri: item.photos[0] }} style={styles.image} />
        ) : (
          <View style={{...styles.image, backgroundColor: placeholderColor(item.id)}} />
        )}
        <View style={styles.textWrap}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{item.acquiredFrom}</Text>
            <Text style={styles.meta}>{t("photosCount", { count: item.photos.length })}</Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 14,
    alignItems: "stretch",
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    padding: 12,
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  image: {
    width: 104,
    height: 104,
    borderRadius: 18,
    backgroundColor: "#d8c7b1",
  },
  textWrap: {
    flex: 1,
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    color: "#312218",
  },
  description: {
    color: "#6a5647",
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  meta: {
    color: "#8d6c4a",
    fontSize: 13,
    fontWeight: "600",
  },
});
