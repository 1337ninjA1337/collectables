import { Link, Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { ItemCard } from "@/components/item-card";
import { Screen } from "@/components/screen";
import { useAuth } from "@/lib/auth-context";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import { fetchCollectionById, fetchItemsByCollectionId } from "@/lib/supabase-profiles";
import { CollectableItem, Collection } from "@/lib/types";

export default function CollectionDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { getCollectionById, getItemsForCollection, deleteCollection, isCollectionFollowed, followCollection, unfollowCollection } = useCollections();
  const { t } = useI18n();
  const localCollection = getCollectionById(params.id);
  const [remoteCollection, setRemoteCollection] = useState<Collection | null>(null);
  const [remoteItems, setRemoteItems] = useState<CollectableItem[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  useEffect(() => {
    if (!localCollection && params.id && params.id !== "[id]") {
      setLoadingRemote(true);
      Promise.all([
        fetchCollectionById(params.id),
        fetchItemsByCollectionId(params.id),
      ])
        .then(([c, items]) => {
          setRemoteCollection(c);
          setRemoteItems(items);
        })
        .catch(() => {})
        .finally(() => setLoadingRemote(false));
    }
  }, [localCollection, params.id]);

  const collection = localCollection ?? remoteCollection;
  const localItems = getItemsForCollection(params.id);

  if (loadingRemote && !collection) {
    return (
      <Screen>
        <ActivityIndicator color="#d89c5b" size="large" />
      </Screen>
    );
  }

  if (!collection) {
    return (
      <Screen>
        <Text style={styles.emptyTitle}>{t("collectionNotFound")}</Text>
      </Screen>
    );
  }

  const activeCollection = collection;
  const items = localItems.length > 0 ? localItems : remoteItems;

  async function confirmAndDeleteCollection() {
    await deleteCollection(activeCollection.id);
    router.replace("/");
  }

  function handleDeleteCollection() {
    const message = `${t("deleteCollectionTitle")} ${t("deleteCollectionText")}`;

    if (Platform.OS === "web") {
      if (globalThis.confirm(message)) {
        void confirmAndDeleteCollection();
      }
      return;
    }

    Alert.alert(t("deleteCollectionTitle"), t("deleteCollectionText"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => {
          void confirmAndDeleteCollection();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: activeCollection.name }} />
      <View style={{...styles.hero, ...(!activeCollection.coverPhoto ? { backgroundColor: placeholderColor(activeCollection.id) } : {})}}>
        {activeCollection.coverPhoto ? <Image source={{ uri: activeCollection.coverPhoto }} style={styles.heroImage} /> : null}
        <View style={styles.heroOverlay} />
        <View style={styles.heroContent}>
          <Text style={styles.heroTitle}>{activeCollection.name}</Text>
          <Text style={styles.heroText}>{activeCollection.description}</Text>
          <Text style={styles.heroMeta}>
            {activeCollection.role === "owner"
              ? t("accessOpenFor", { count: activeCollection.sharedWith.length })
              : t("viewingCollectionOf", { name: activeCollection.ownerName })}
          </Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNumber}>{items.length}</Text>
          <Text style={styles.summaryLabel}>{t("itemsInside")}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNumber}>{items.reduce((total, item) => total + item.photos.length, 0)}</Text>
          <Text style={styles.summaryLabel}>{t("photosSaved")}</Text>
        </View>
      </View>

      {user?.id === activeCollection.ownerUserId ? (
        <View style={styles.ownerActions}>
          <Link href={{ pathname: "/create", params: { collectionId: activeCollection.id } }} asChild>
            <Pressable style={styles.addButton}>
              <Text style={styles.addButtonText}>{t("addItemToCollection")}</Text>
            </Pressable>
          </Link>
          <Pressable style={styles.deleteButton} onPress={handleDeleteCollection}>
            <Text style={styles.deleteButtonText}>{t("deleteCollection")}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.ownerActions}>
          {isCollectionFollowed(activeCollection.id) ? (
            <Pressable style={styles.unfollowButton} onPress={() => void unfollowCollection(activeCollection.id)}>
              <Text style={styles.unfollowButtonText}>{t("unfollowCollection")}</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.addButton} onPress={() => void followCollection(activeCollection.id)}>
              <Text style={styles.addButtonText}>{t("followCollection")}</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.listWrap}>
        <Text style={styles.listTitle}>{t("collectionItems")}</Text>
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 280,
    borderRadius: 30,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: "#cfb394",
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26, 18, 14, 0.35)",
  },
  heroContent: {
    padding: 20,
    gap: 8,
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "800",
  },
  heroText: {
    color: "#f8eee3",
    lineHeight: 22,
    fontSize: 15,
  },
  heroMeta: {
    color: "#ffd7ab",
    fontWeight: "700",
    fontSize: 14,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 24,
    padding: 18,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    gap: 6,
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: "800",
    color: "#2d2117",
  },
  summaryLabel: {
    color: "#715d4d",
    lineHeight: 21,
  },
  listWrap: {
    gap: 12,
  },
  ownerActions: {
    gap: 12,
  },
  addButton: {
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: "#261b14",
    alignItems: "center",
  },
  addButtonText: {
    color: "#fff4e8",
    fontSize: 16,
    fontWeight: "800",
  },
  deleteButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#d9a0a0",
    backgroundColor: "#fff3f3",
    alignItems: "center",
  },
  deleteButtonText: {
    color: "#8d2b2b",
    fontSize: 15,
    fontWeight: "800",
  },
  unfollowButton: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#e4c29a",
    backgroundColor: "#fff1df",
    alignItems: "center",
  },
  unfollowButtonText: {
    color: "#2a1d15",
    fontSize: 15,
    fontWeight: "800",
  },
  listTitle: {
    color: "#2d2117",
    fontSize: 22,
    fontWeight: "800",
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#2d2117",
  },
});
