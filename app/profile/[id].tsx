import * as ImagePicker from "expo-image-picker";
import { Link, Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { CollectionCard } from "@/components/collection-card";
import { Screen } from "@/components/screen";
import { uploadImage } from "@/lib/cloudinary";
import { useCollections } from "@/lib/collections-context";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";
import { fetchProfileById, fetchCollectionsByUserId, fetchItemsByCollectionId } from "@/lib/supabase-profiles";
import { CollectableItem, Collection, UserProfile } from "@/lib/types";

const DEFAULT_EN_PROFILE_BIO = "I collect things worth saving beautifully and sharing with friends.";

export default function ProfileScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const {
    getProfileById,
    getRelationship,
    addFriend,
    removeFriend,
    followProfile,
    unfollowProfile,
    updateMyProfile,
    deleteProfile,
    isAdmin,
  } = useSocial();
  const { collections, getItemsForCollection, deleteUserContent } = useCollections();
  const localProfile = getProfileById(params.id);
  const [remoteProfile, setRemoteProfile] = useState<UserProfile | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [profileIdDraft, setProfileIdDraft] = useState("");
  const [editingHandle, setEditingHandle] = useState(false);
  const [remoteCollections, setRemoteCollections] = useState<Collection[]>([]);
  const [remoteItemCounts, setRemoteItemCounts] = useState<Record<string, number>>({});

  useFocusEffect(
    useCallback(() => {
      if (!params.id || params.id === "[id]") return;

      let active = true;
      const needsProfileFetch = !localProfile;
      if (needsProfileFetch) setLoadingRemote(true);

      const profilePromise = needsProfileFetch
        ? fetchProfileById(params.id)
        : Promise.resolve(null);

      Promise.all([profilePromise, fetchCollectionsByUserId(params.id)])
        .then(([p, cols]) => {
          if (!active) return;
          if (needsProfileFetch) setRemoteProfile(p);
          setRemoteCollections(cols);
          return loadItemCounts(cols, () => active);
        })
        .catch(() => {})
        .finally(() => {
          if (active && needsProfileFetch) setLoadingRemote(false);
        });

      return () => {
        active = false;
      };
    }, [localProfile, params.id]),
  );

  async function loadItemCounts(cols: Collection[], isActive: () => boolean = () => true) {
    const counts: Record<string, number> = {};
    const results = await Promise.all(
      cols.map((c) => fetchItemsByCollectionId(c.id).then((items) => ({ id: c.id, count: items.length })))
    );
    if (!isActive()) return;
    results.forEach((r) => { counts[r.id] = r.count; });
    setRemoteItemCounts(counts);
  }

  const profile = localProfile ?? remoteProfile;
  const activeProfile = profile;
  const relationship = activeProfile ? getRelationship(activeProfile.id) : "none" as const;
  const localProfileCollections = activeProfile
    ? collections.filter((collection) => collection.ownerUserId === activeProfile.id)
    : [];
  // Use remote collections if no local ones found (other user's profile)
  const profileCollections = localProfileCollections.length > 0 ? localProfileCollections : remoteCollections;
  const localizedBio = activeProfile
    ? (activeProfile.bio === DEFAULT_EN_PROFILE_BIO ? t("defaultProfileBio") : activeProfile.bio)
    : "";

  useEffect(() => {
    if (activeProfile) {
      setBioDraft(activeProfile.bio === DEFAULT_EN_PROFILE_BIO ? t("defaultProfileBio") : activeProfile.bio);
      setProfileIdDraft(activeProfile.username);
    }
  }, [activeProfile?.bio, activeProfile?.username, t]);

  if (loadingRemote && !profile) {
    return (
      <Screen>
        <ActivityIndicator color="#d89c5b" size="large" />
      </Screen>
    );
  }

  if (!profile) {
    return (
      <Screen>
        <Text style={styles.emptyTitle}>{t("profileNotFound")}</Text>
      </Screen>
    );
  }

  async function handleChangeAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t("noAccess"), t("noAccessCover"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.8,
    });

    if (!result.canceled) {
      const localUri = result.assets[0]?.uri;
      if (localUri) {
        const cloudUrl = await uploadImage(localUri);
        await updateMyProfile({ avatar: cloudUrl });
      }
    }
  }

  async function handleSaveBio() {
    await updateMyProfile({
      bio: bioDraft.trim() || localizedBio,
    });
  }

  async function handleSaveProfileId() {
    await updateMyProfile({
      username: profileIdDraft.trim() || activeProfile.username,
    });
    setEditingHandle(false);
  }

  async function performAdminDelete() {
    await deleteUserContent(activeProfile.id);
    await deleteProfile(activeProfile.id);
    router.replace("/people");
  }

  function handleAdminDelete() {
    if (!isAdmin || relationship === "self") {
      return;
    }

    const title = t("adminDeleteProfileTitle");
    const message = t("adminDeleteProfileText", { name: activeProfile.displayName });

    if (Platform.OS === "web") {
      const confirmed = globalThis.confirm?.(`${title}\n\n${message}`) ?? false;
      if (confirmed) {
        void performAdminDelete();
      }
      return;
    }

    Alert.alert(title, message, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => void performAdminDelete(),
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: activeProfile.displayName }} />
      <View style={styles.hero}>
        <Image source={{ uri: activeProfile.avatar }} style={styles.avatar} />
        {relationship === "self" ? (
          <Pressable style={styles.editAvatarButton} onPress={handleChangeAvatar}>
            <Text style={styles.editAvatarButtonText}>{t("changeProfilePhoto")}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.name}>{activeProfile.displayName}</Text>
        <View style={styles.handleRow}>
          {editingHandle && relationship === "self" ? (
            <>
              <Text style={styles.handlePrefix}>@</Text>
              <TextInput
                value={profileIdDraft}
                onChangeText={setProfileIdDraft}
                placeholder={t("profileIdPlaceholder")}
                placeholderTextColor="#c7b19b"
                autoCapitalize="none"
                style={styles.handleInput}
              />
              <Pressable style={styles.handleAction} onPress={() => void handleSaveProfileId()}>
                <Text style={styles.handleActionText}>OK</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.username}>@{activeProfile.username}</Text>
              {relationship === "self" ? (
                <Pressable style={styles.handleAction} onPress={() => setEditingHandle(true)}>
                  <Text style={styles.handleActionText}>Edit</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
        <Text style={styles.bio}>{localizedBio}</Text>
      </View>

      {relationship === "self" ? (
        <View style={styles.selfTools}>
          <View style={styles.languageCard}>
            <Text style={styles.sectionTitle}>{t("descriptionLabel")}</Text>
            <Text style={styles.sectionText}>{t("descriptionPlaceholder")}</Text>
            <TextInput
              value={bioDraft}
              onChangeText={setBioDraft}
              placeholder={t("descriptionPlaceholder")}
              placeholderTextColor="#9b8571"
              multiline
              textAlignVertical="top"
              style={styles.bioInput}
            />
            <Pressable style={styles.saveBioButton} onPress={() => void handleSaveBio()}>
              <Text style={styles.saveBioButtonText}>{t("saveProfileDescription")}</Text>
            </Pressable>
          </View>

        </View>
      ) : (
        <View style={styles.actions}>
          {isAdmin ? (
            <Pressable style={styles.adminAction} onPress={handleAdminDelete}>
              <Text style={styles.adminActionText}>{t("adminDeleteProfile")}</Text>
            </Pressable>
          ) : null}
          {relationship === "friend" ? (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void removeFriend(activeProfile.id)}>
                <Text style={styles.primaryActionText}>{t("removeFriend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void unfollowProfile(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("unfollow")}</Text>
              </Pressable>
            </>
          ) : relationship === "request_sent" ? (
            <>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>{t("requestSent")}</Text>
              </View>
              <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("cancelInvitation")}</Text>
              </Pressable>
            </>
          ) : relationship === "request_received" ? (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(activeProfile.id)}>
                <Text style={styles.primaryActionText}>{t("acceptRequest")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void removeFriend(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("rejectRequest")}</Text>
              </Pressable>
            </>
          ) : relationship === "following" ? (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(activeProfile.id)}>
                <Text style={styles.primaryActionText}>{t("addFriend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void unfollowProfile(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("unfollow")}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={styles.primaryAction} onPress={() => void addFriend(activeProfile.id)}>
                <Text style={styles.primaryActionText}>{t("addFriend")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => void followProfile(activeProfile.id)}>
                <Text style={styles.secondaryActionText}>{t("follow")}</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("profileCollections")}</Text>
        {profileCollections.length > 0 ? (
          profileCollections.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              count={getItemsForCollection(collection.id).length || remoteItemCounts[collection.id] || 0}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{t("subscribeToSeeCollections")}</Text>
            <Link href="/people" asChild>
              <Pressable style={styles.browseButton}>
                <Text style={styles.browseButtonText}>{t("findPeople")}</Text>
              </Pressable>
            </Link>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 32,
    backgroundColor: "#261b14",
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 32,
    backgroundColor: "#d2b89a",
  },
  editAvatarButton: {
    borderRadius: 999,
    backgroundColor: "rgba(255, 244, 229, 0.12)",
    borderWidth: 1,
    borderColor: "#6e5541",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  editAvatarButtonText: {
    color: "#fff4e8",
    fontWeight: "800",
  },
  name: {
    color: "#fff7ef",
    fontSize: 28,
    fontWeight: "800",
  },
  username: {
    color: "#f5c99a",
    fontWeight: "700",
  },
  handleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  handlePrefix: {
    color: "#f5c99a",
    fontWeight: "700",
    fontSize: 16,
  },
  handleInput: {
    minWidth: 120,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "#6e5541",
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#fff7ef",
    fontSize: 15,
    fontWeight: "700",
  },
  handleAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#6e5541",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  handleActionText: {
    color: "#fff4e8",
    fontWeight: "800",
  },
  bio: {
    color: "#ead8c3",
    lineHeight: 22,
    textAlign: "center",
  },
  languageCard: {
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 18,
    gap: 12,
  },
  selfTools: {
    gap: 14,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryAction: {
    borderRadius: 999,
    backgroundColor: "#261b14",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryActionText: {
    color: "#fff4e8",
    fontWeight: "800",
  },
  secondaryAction: {
    borderRadius: 999,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryActionText: {
    color: "#2a1d15",
    fontWeight: "800",
  },
  statusBadge: {
    borderRadius: 999,
    backgroundColor: "#f0e2cf",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusBadgeText: {
    color: "#6b5543",
    fontWeight: "800",
  },
  adminAction: {
    borderRadius: 999,
    backgroundColor: "#922a2a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  adminActionText: {
    color: "#fff4e8",
    fontWeight: "800",
  },
  section: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#2f2318",
  },
  sectionText: {
    color: "#6b5647",
    lineHeight: 22,
  },
  bioInput: {
    minHeight: 120,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#2f2318",
    fontSize: 15,
    lineHeight: 22,
  },
  saveBioButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#261b14",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  saveBioButtonText: {
    color: "#fff4e8",
    fontWeight: "800",
  },
  emptyCard: {
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 18,
    gap: 12,
  },
  emptyText: {
    color: "#6b5647",
    lineHeight: 22,
  },
  browseButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#261b14",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  browseButtonText: {
    color: "#fff4e8",
    fontWeight: "800",
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#2d2117",
  },
});
