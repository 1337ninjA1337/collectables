import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/screen";
import { useAuth } from "@/lib/auth-context";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { fetchItemById } from "@/lib/supabase-profiles";
import { CollectableItem } from "@/lib/types";

export default function ItemDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { getItemById, getCollectionById, deleteItem } = useCollections();
  const { t } = useI18n();
  const localItem = getItemById(params.id);
  const [remoteItem, setRemoteItem] = useState<CollectableItem | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);

  useEffect(() => {
    if (!localItem && params.id && params.id !== "[id]") {
      setLoadingRemote(true);
      fetchItemById(params.id)
        .then((i) => setRemoteItem(i))
        .catch(() => {})
        .finally(() => setLoadingRemote(false));
    }
  }, [localItem, params.id]);

  const item = localItem ?? remoteItem;

  if (loadingRemote && !item) {
    return (
      <Screen>
        <ActivityIndicator color="#d89c5b" size="large" />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen>
        <Text style={styles.emptyTitle}>{t("itemNotFound")}</Text>
      </Screen>
    );
  }

  const activeItem = item;
  const collection = getCollectionById(activeItem.collectionId);

  async function confirmAndDeleteItem() {
    await deleteItem(activeItem.id);
    router.replace(collection ? `/collection/${collection.id}` : "/");
  }

  function handleDelete() {
    const message = `${t("deleteItemTitle")} ${t("deleteItemText")}`;

    if (Platform.OS === "web") {
      if (globalThis.confirm(message)) {
        void confirmAndDeleteItem();
      }
      return;
    }

    Alert.alert(t("deleteItemTitle"), t("deleteItemText"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => {
          void confirmAndDeleteItem();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: activeItem.title }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
        {activeItem.photos.length > 0 ? (
          activeItem.photos.map((photo) => (
            <Image key={photo} source={{ uri: photo }} style={styles.galleryImage} />
          ))
        ) : (
          <View style={{...styles.galleryImage, backgroundColor: placeholderColor(activeItem.id)}} />
        )}
      </ScrollView>

      <View style={styles.headerCard}>
        <Text style={styles.itemTitle}>{activeItem.title}</Text>
        <Text style={styles.itemMeta}>{t("collectionField", { name: collection?.name ?? t("collectionMissing") })}</Text>
        <Text style={styles.itemMeta}>{t("addedBy", { name: activeItem.createdBy })}</Text>
      </View>

      {user?.id === activeItem.createdByUserId ? (
        <Pressable style={styles.deleteButton} onPress={handleDelete}>
          <Text style={styles.deleteButtonText}>{t("deleteItem")}</Text>
        </Pressable>
      ) : null}

      <View style={styles.sheet}>
        <Text style={styles.sheetLabel}>{t("acquiredHow")}</Text>
        <Text style={styles.sheetValue}>{activeItem.acquiredFrom}</Text>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sheetLabel}>{t("acquiredDate")}</Text>
        <Text style={styles.sheetValue}>{activeItem.acquiredAt}</Text>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sheetLabel}>{t("description")}</Text>
        <Text style={styles.sheetValue}>{activeItem.description}</Text>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sheetLabel}>{t("variants")}</Text>
        <Text style={styles.sheetValue}>{activeItem.variants}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gallery: {
    gap: 12,
    paddingRight: 20,
  },
  galleryImage: {
    width: 280,
    height: 320,
    borderRadius: 28,
    backgroundColor: "#ddc9af",
  },
  headerCard: {
    borderRadius: 28,
    padding: 20,
    backgroundColor: "#2a1e17",
    gap: 6,
  },
  deleteButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d99393",
    backgroundColor: "#fff1f1",
    paddingVertical: 16,
    alignItems: "center",
  },
  deleteButtonText: {
    color: "#8a2727",
    fontSize: 15,
    fontWeight: "800",
  },
  itemTitle: {
    color: "#fff7ed",
    fontSize: 29,
    fontWeight: "800",
  },
  itemMeta: {
    color: "#dfc8b2",
    fontSize: 14,
    lineHeight: 21,
  },
  sheet: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    gap: 8,
  },
  sheetLabel: {
    color: "#8f6947",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "800",
  },
  sheetValue: {
    color: "#2f2318",
    fontSize: 16,
    lineHeight: 24,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#2d2117",
  },
});
