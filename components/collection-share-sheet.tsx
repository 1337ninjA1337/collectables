import { memo } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ShareSheet } from "@/components/share-sheet";
import {
  BORDER_7,
  HERO_DARK,
  MUTED_2,
  MUTED_17,
  PURE_WHITE,
  RADIUS_PILL,
  SPACING_LIST,
  SUCCESS_GREEN_2,
  TEXT_DARK,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";
import { buildDeepLink } from "@/lib/deep-link";
import { FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import { placeholderColor } from "@/lib/placeholder-color";
import type { UserProfile } from "@/lib/types";

type Props = {
  visible: boolean;
  collectionId: string;
  collectionName: string;
  sharedWithUserIds: string[];
  isOwner: boolean;
  friends: string[];
  getProfileById: (userId: string) => UserProfile | undefined;
  onShare: (friendId: string) => void;
  onUnshare: (viewerId: string) => void;
  onClose: () => void;
};

// HM-C2: extracted from app/collection/[id].tsx's modalsBlock so the hidden
// <Modal visible={false}> subtree skips reconciliation during scroll-driven
// parent re-renders — the handlers are hoisted useCallbacks and
// `sharedWithUserIds` is the page's memoized fallback array, so the memo's
// props diff only fails when the sheet actually needs to change.
//
// The sheet chrome (handle bar + title/hint + link box + copy/native actions +
// Cancel) and the copy-feedback state now live in the shared <ShareSheet>;
// what stays here is the collection-only sharing UI it layers in as children.
export const CollectionShareSheet = memo(function CollectionShareSheet({
  visible,
  collectionId,
  collectionName,
  sharedWithUserIds,
  isOwner,
  friends,
  getProfileById,
  onShare,
  onUnshare,
  onClose,
}: Props) {
  const { t } = useI18n();

  return (
    <ShareSheet
      visible={visible}
      url={buildDeepLink(`collection/${collectionId}`)}
      hint={t("shareCollectionHint")}
      message={collectionName}
      onClose={onClose}
    >
      {isOwner && friends.length > 0 ? (
        <View style={styles.shareFriendsSection}>
          <Text style={styles.shareFriendsTitle}>{t("shareWithFriends")}</Text>
          <Text style={styles.shareFriendsHint}>{t("shareWithFriendsHint")}</Text>
          <ScrollView style={styles.shareFriendsList} nestedScrollEnabled>
            {friends.map((friendId) => {
              const profile = getProfileById(friendId);
              if (!profile) return null;
              const isShared = sharedWithUserIds.includes(friendId);
              return (
                <View key={friendId} style={styles.shareFriendRow}>
                  <View style={styles.shareFriendInfo}>
                    {profile.avatar ? (
                      <Image source={{ uri: profile.avatar }} style={styles.shareFriendAvatar} />
                    ) : (
                      <View style={{...styles.shareFriendAvatar, backgroundColor: placeholderColor(friendId)}} />
                    )}
                    <Text style={styles.shareFriendName} numberOfLines={1}>{profile.displayName}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    style={{...styles.shareFriendButton, ...(isShared ? styles.shareFriendButtonActive : {})}}
                    onPress={() => {
                      if (isShared) {
                        onUnshare(friendId);
                      } else {
                        onShare(friendId);
                      }
                    }}
                  >
                    <Text style={{...styles.shareFriendButtonText, ...(isShared ? styles.shareFriendButtonTextActive : {})}}>
                      {isShared ? t("shared") : t("share")}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : isOwner && friends.length === 0 ? (
        <Text style={styles.shareFriendsEmpty}>{t("noFriendsToShare")}</Text>
      ) : null}
      {isOwner && sharedWithUserIds.length > 0 ? (
        <View style={styles.shareFriendsSection}>
          <Text style={styles.shareFriendsTitle}>{t("peopleWithAccess")}</Text>
          <Text style={styles.shareFriendsHint}>{t("peopleWithAccessHint")}</Text>
          <ScrollView style={styles.shareFriendsList} nestedScrollEnabled>
            {sharedWithUserIds.map((viewerId) => {
              const profile = getProfileById(viewerId);
              const displayName = profile?.displayName ?? profile?.username ?? viewerId;
              return (
                <View key={viewerId} style={styles.shareFriendRow}>
                  <View style={styles.shareFriendInfo}>
                    {profile?.avatar ? (
                      <Image source={{ uri: profile.avatar }} style={styles.shareFriendAvatar} />
                    ) : (
                      <View style={{...styles.shareFriendAvatar, backgroundColor: placeholderColor(viewerId)}} />
                    )}
                    <Text style={styles.shareFriendName} numberOfLines={1}>{displayName}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.shareFriendButton}
                    onPress={() => onUnshare(viewerId)}
                  >
                    <Text style={styles.shareFriendButtonText}>{t("removeAccess")}</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </ShareSheet>
  );
});

const styles = StyleSheet.create({
  shareFriendsSection: {
    gap: SPACING_LIST,
    marginTop: 4,
  },
  shareFriendsTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareFriendsHint: {
    color: MUTED_2,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_BODY,
  },
  shareFriendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_7,
  },
  shareFriendInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_LIST,
    flex: 1,
  },
  shareFriendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  shareFriendName: {
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
    fontFamily: FONT_BODY_BOLD,
  },
  shareFriendButton: {
    borderRadius: RADIUS_PILL,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: HERO_DARK,
  },
  shareFriendButtonActive: {
    backgroundColor: SUCCESS_GREEN_2,
  },
  shareFriendButtonText: {
    color: TEXT_ON_DARK_2,
    fontSize: 13,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareFriendButtonTextActive: {
    color: PURE_WHITE,
  },
  shareFriendsList: {
    maxHeight: 228,
  },
  shareFriendsEmpty: {
    color: MUTED_17,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
    fontFamily: FONT_BODY,
  },
});
