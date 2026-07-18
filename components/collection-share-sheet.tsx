import { memo, useState } from "react";
import { Image, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import {
  AMBER_ACCENT,
  AMBER_SOFT,
  BORDER,
  BORDER_7,
  CARD_BG,
  HERO_DARK,
  MUTED,
  MUTED_2,
  MUTED_17,
  PURE_WHITE,
  RADIUS_PILL,
  SPACING_CARD,
  SPACING_LIST,
  SUCCESS_GREEN_2,
  TEXT_DARK,
  TEXT_DARK_2,
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
// props diff only fails when the sheet actually needs to change. The
// `linkCopied` copy-feedback state (and its 2s reset timer) lives HERE, not
// in the page: flipping it re-renders only the sheet.
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
  const [linkCopied, setLinkCopied] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.shareBackdrop} onPress={onClose}>
        <Pressable style={styles.shareSheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView style={styles.shareScrollView} bounces={false}>
          <View style={styles.shareHandle} />
          <Text style={styles.shareTitle}>{t("shareTitle")}</Text>
          <Text style={styles.shareHint}>{t("shareCollectionHint")}</Text>
          <View style={styles.shareLinkBox}>
            <Text style={styles.shareLinkText} numberOfLines={1}>{buildDeepLink(`collection/${collectionId}`)}</Text>
          </View>
          <View style={styles.shareActions}>
            <Pressable
              style={{...styles.shareCopyButton, ...(linkCopied ? styles.shareCopyButtonDone : {})}}
              onPress={() => {
                const link = buildDeepLink(`collection/${collectionId}`);
                if (Platform.OS === "web" && navigator.clipboard) {
                  navigator.clipboard.writeText(link).then(() => {
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                  });
                }
              }}
            >
              <Text style={{...styles.shareCopyButtonText, ...(linkCopied ? styles.shareCopyButtonTextDone : {})}}>
                {linkCopied ? t("linkCopied") : t("copyLink")}
              </Text>
            </Pressable>
            {Platform.OS !== "web" ? (
              <Pressable
                style={styles.shareNativeButton}
                onPress={() => {
                  const link = buildDeepLink(`collection/${collectionId}`);
                  Share.share({ message: `${collectionName}\n${link}`, url: link });
                }}
              >
                <Text style={styles.shareNativeButtonText}>{t("shareVia")}</Text>
              </Pressable>
            ) : null}
          </View>
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
          <Pressable style={styles.shareCancelButton} onPress={onClose}>
            <Text style={styles.shareCancelText}>{t("cancel")}</Text>
          </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  shareBackdrop: {
    flex: 1,
    backgroundColor: "rgba(38, 27, 20, 0.4)",
    justifyContent: "flex-end",
  },
  shareSheet: {
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: SPACING_CARD,
  },
  shareScrollView: {
    gap: SPACING_CARD,
  },
  shareHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: AMBER_SOFT,
  },
  shareTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareHint: {
    color: MUTED_2,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_BODY,
  },
  shareLinkBox: {
    borderRadius: 16,
    backgroundColor: PURE_WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  shareLinkText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  shareActions: {
    flexDirection: "row",
    gap: SPACING_LIST,
  },
  shareCopyButton: {
    flex: 1,
    borderRadius: RADIUS_PILL,
    backgroundColor: HERO_DARK,
    paddingVertical: 14,
    alignItems: "center",
  },
  shareCopyButtonDone: {
    backgroundColor: SUCCESS_GREEN_2,
  },
  shareCopyButtonText: {
    color: TEXT_ON_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  shareCopyButtonTextDone: {
    color: PURE_WHITE,
  },
  shareNativeButton: {
    flex: 1,
    borderRadius: RADIUS_PILL,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 14,
    alignItems: "center",
  },
  shareNativeButtonText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
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
  shareCancelButton: {
    borderRadius: RADIUS_PILL,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: PURE_WHITE,
  },
  shareCancelText: {
    color: TEXT_DARK,
    fontWeight: "800",
    fontSize: 14,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
