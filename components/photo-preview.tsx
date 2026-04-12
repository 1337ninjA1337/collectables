import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/lib/i18n-context";

type Props = {
  photos: string[];
  onChange: (photos: string[]) => void;
  maxPhotos?: number;
};

export function PhotoPreview({ photos, onChange, maxPhotos = 5 }: Props) {
  const { t } = useI18n();

  function removePhoto(index: number) {
    onChange(photos.filter((_, i) => i !== index));
  }

  function movePhoto(from: number, to: number) {
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  if (photos.length === 0) {
    return <Text style={styles.hint}>{t("upTo5Photos")}</Text>;
  }

  return (
    <View style={styles.grid}>
      {photos.map((photo, index) => (
        <View key={`${photo}-${index}`} style={styles.item}>
          <Image source={{ uri: photo }} style={styles.image} />

          {/* Order badge */}
          <View style={styles.orderBadge}>
            <Text style={styles.orderText}>{index + 1}</Text>
          </View>

          {/* Delete button */}
          <Pressable
            style={styles.deleteButton}
            onPress={() => removePhoto(index)}
            hitSlop={6}
            accessibilityLabel={t("delete")}
          >
            <Ionicons name="close" size={14} color="#fff" />
          </Pressable>

          {/* Move arrows */}
          <View style={styles.moveRow}>
            {index > 0 ? (
              <Pressable
                style={styles.moveButton}
                onPress={() => movePhoto(index, index - 1)}
                hitSlop={4}
              >
                <Ionicons name="chevron-back" size={14} color="#fff7ef" />
              </Pressable>
            ) : (
              <View style={styles.moveButtonPlaceholder} />
            )}
            {index < photos.length - 1 ? (
              <Pressable
                style={styles.moveButton}
                onPress={() => movePhoto(index, index + 1)}
                hitSlop={4}
              >
                <Ionicons name="chevron-forward" size={14} color="#fff7ef" />
              </Pressable>
            ) : (
              <View style={styles.moveButtonPlaceholder} />
            )}
          </View>
        </View>
      ))}

      {photos.length < maxPhotos ? (
        <View style={styles.counterWrap}>
          <Text style={styles.counterText}>
            {photos.length}/{maxPhotos}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  hint: {
    color: "#7a6453",
    lineHeight: 22,
  },
  item: {
    width: 104,
    height: 104,
    borderRadius: 18,
    overflow: "hidden",
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
    borderRadius: 18,
    backgroundColor: "#dbc7ae",
  },
  orderBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(38, 27, 20, 0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: {
    color: "#fff7ef",
    fontSize: 11,
    fontWeight: "800",
  },
  deleteButton: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(141, 43, 43, 0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  moveRow: {
    position: "absolute",
    bottom: 6,
    left: 6,
    right: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  moveButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(38, 27, 20, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  moveButtonPlaceholder: {
    width: 26,
    height: 26,
  },
  counterWrap: {
    width: 104,
    height: 104,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#eadbc8",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffaf3",
  },
  counterText: {
    color: "#9b8571",
    fontSize: 14,
    fontWeight: "700",
  },
});
