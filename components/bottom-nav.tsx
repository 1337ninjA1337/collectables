import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NavTab, NavItem } from "@/components/nav-tab";
import { useResponsive } from "@/components/screen";
import { useAppTheme } from "@/components/use-app-theme";
import { trackEvent } from "@/lib/analytics";
import { useChat } from "@/lib/chat-context";
import { FriendsTabBadge } from "@/lib/chat-helpers";
import {
  AMBER_ACCENT,
  AMBER_SOFT,
  CARD_BG_2,
  CARD_BG_3,
  HERO_DARK,
  MUTED_3,
  RADIUS_CARD,
  SPACING_CARD,
  TEXT_DARK_2,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useNavAnimation } from "@/lib/nav-animation-context";
import { usePremium } from "@/lib/premium-context";
import { useSocial } from "@/lib/social-context";
import { useToast } from "@/lib/toast-context";
import { FONT_BODY_EXTRABOLD } from "@/lib/fonts";

export const BOTTOM_NAV_HEIGHT = 58;

type NavRowProps = {
  leftItems: NavItem[];
  rightItems: NavItem[];
  onPlusPress: () => void;
  plusLabel: string;
};

function NavRow({ leftItems, rightItems, onPlusPress, plusLabel }: NavRowProps) {
  const theme = useAppTheme();
  const slots = Math.max(leftItems.length, rightItems.length);
  const paddedLeft = [...leftItems, ...Array(slots - leftItems.length).fill(null)];
  const paddedRight = [...rightItems, ...Array(slots - rightItems.length).fill(null)];
  const plusBg = theme.isDark ? AMBER_ACCENT : HERO_DARK;
  const plusIconColor = theme.isDark ? HERO_DARK : TEXT_ON_DARK_2;
  return (
    <>
      {paddedLeft.map((item, i) =>
        item ? (
          <NavTab key={item.key} item={item} />
        ) : (
          <View key={`left-spacer-${i}`} style={styles.item} />
        ),
      )}
      <View style={styles.item}>
        <Pressable
          style={{ ...styles.plusButton, backgroundColor: plusBg, borderColor: theme.navBg }}
          onPress={onPlusPress}
          accessibilityLabel={plusLabel}
        >
          <Ionicons name="add" size={30} color={plusIconColor} />
        </Pressable>
      </View>
      {paddedRight.map((item, i) =>
        item ? (
          <NavTab key={item.key} item={item} />
        ) : (
          <View key={`right-spacer-${i}`} style={styles.item} />
        ),
      )}
    </>
  );
}

type BottomNavProps = {
  onSearchPress?: () => void;
};

export function BottomNav({ onSearchPress }: BottomNavProps) {
  const pathname = usePathname();
  const { getMyProfile, incomingRequestUserIds } = useSocial();
  const { unreadTotal } = useChat();
  const { isPremium, consumeLastPremiumIntent } = usePremium();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { setAnimation } = useNavAnimation();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const { isMobile } = useResponsive();
  const theme = useAppTheme();

  const prevIsPremium = useRef(isPremium);
  useEffect(() => {
    if (!prevIsPremium.current && isPremium) {
      toast.success(t("premiumActive"));
      trackEvent("premium_activated", {
        source: consumeLastPremiumIntent(),
      });
    }
    prevIsPremium.current = isPremium;
  }, [consumeLastPremiumIntent, isPremium, t, toast]);

  if (!isMobile) return null;

  const myProfile = getMyProfile();
  const onHome = pathname === "/";
  const onSearch = pathname === "/people" || pathname.startsWith("/people");
  const onChats = pathname === "/chats" || pathname.startsWith("/chat");
  const onFriends = pathname === "/friends" || pathname.startsWith("/friends");
  const onMarketplace = pathname === "/marketplace" || pathname.startsWith("/marketplace") || pathname.startsWith("/listing");
  const onProfile = pathname.startsWith("/profile");

  // Active highlights are mutually exclusive: friends takes precedence over search
  const friendsActive = onFriends;
  const searchActive = onSearch && !onFriends;
  const marketplaceActive = onMarketplace;
  const chatsActive = onChats;

  // Tab order indices for direction-aware transitions
  // 0: home, 1: search, 2: marketplace, 3: chats, 4: friends, 5: profile
  const currentTabIndex = onHome
    ? 0
    : searchActive
      ? 1
      : marketplaceActive
        ? 2
        : chatsActive
          ? 3
          : friendsActive
            ? 4
            : onProfile
              ? 5
              : -1;

  function applyAnimation(targetIndex: number) {
    if (currentTabIndex < 0 || targetIndex === currentTabIndex) {
      setAnimation("default");
      return;
    }
    setAnimation(targetIndex > currentTabIndex ? "slide_from_right" : "slide_from_left");
  }

  function navTo(target: string, isActive: boolean, targetIndex: number) {
    if (isActive) return; // don't re-open active tab
    applyAnimation(targetIndex);
    // Defer push so the animation context state commits before navigation
    setTimeout(() => router.push(target as never), 0);
  }

  function goHome() {
    if (onHome) return;
    applyAnimation(0);
    setTimeout(() => router.replace("/"), 0);
  }

  const chatsBadge: FriendsTabBadge = unreadTotal > 0 ? { kind: "count", value: unreadTotal } : { kind: "none" };
  const friendsBadge: FriendsTabBadge = incomingRequestUserIds.length > 0 ? { kind: "dot" } : { kind: "none" };

  const items: NavItem[] = [
    {
      key: "home",
      icon: "home-outline",
      iconActive: "home",
      active: onHome,
      onPress: goHome,
    },
    {
      key: "search",
      icon: "search-outline",
      iconActive: "search",
      active: false,
      onPress: () => onSearchPress?.(),
    },
    {
      key: "marketplace",
      icon: "storefront-outline",
      iconActive: "storefront",
      active: marketplaceActive,
      onPress: () => navTo("/marketplace", marketplaceActive, 2),
    },
    {
      key: "chats",
      icon: "chatbubbles-outline",
      iconActive: "chatbubbles",
      active: chatsActive,
      badge: chatsBadge,
      onPress: () => navTo("/chats", chatsActive, 3),
    },
    {
      key: "friends",
      icon: "people-outline",
      iconActive: "people",
      active: friendsActive,
      badge: friendsBadge,
      onPress: () => navTo("/friends", friendsActive, 4),
    },
    {
      key: "profile",
      icon: "person-outline",
      iconActive: "person",
      active: onProfile,
      premiumBadge: isPremium,
      onPress: () => {
        if (!myProfile) return;
        const target = `/profile/${myProfile.id}`;
        if (pathname === target) return;
        applyAnimation(5);
        setTimeout(() => router.push(target as never), 0);
      },
    },
  ];

  // Split into 3 left + 3 right and pad the left with a spacer cell so the
  // plus button sits in the exact horizontal center (8 equal-flex cells).
  const leftItems = items.slice(0, 3);
  const rightItems = items.slice(3);

  function openCreate() {
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
  }

  function goCreateItem() {
    closeCreate();
    setAnimation("default");
    setTimeout(() => router.push("/create"), 0);
  }

  function goCreateCollection() {
    closeCreate();
    setAnimation("default");
    setTimeout(() => router.push("/create-collection"), 0);
  }

  return (
    <>
      <View
        style={{
          ...styles.wrap,
          backgroundColor: theme.navBg,
          borderTopColor: theme.border,
          paddingBottom: Math.max(insets.bottom, 8),
        }}
      >
        <NavRow
          leftItems={leftItems}
          rightItems={rightItems}
          onPlusPress={openCreate}
          plusLabel={t("addItem")}
        />
      </View>

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={closeCreate}>
        <Pressable style={styles.modalBackdrop} onPress={closeCreate}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.modalPrimaryButton} onPress={goCreateCollection}>
              <Text style={styles.modalPrimaryText}>{t("createCollection")}</Text>
            </Pressable>
            <Pressable style={styles.modalSecondaryButton} onPress={goCreateItem}>
              <Text style={styles.modalSecondaryText}>{t("addItem")}</Text>
            </Pressable>
            <Pressable style={styles.modalCancelButton} onPress={closeCreate}>
              <Text style={styles.modalCancelText}>{t("cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    borderTopWidth: 1,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  plusButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -18,
    borderWidth: 3,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20, 12, 6, 0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: CARD_BG_2,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 22,
    paddingBottom: 32,
    gap: SPACING_CARD,
  },
  modalPrimaryButton: {
    borderRadius: RADIUS_CARD,
    backgroundColor: HERO_DARK,
    paddingVertical: 16,
    alignItems: "center",
  },
  modalPrimaryText: {
    color: TEXT_ON_DARK_2,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  modalSecondaryButton: {
    borderRadius: RADIUS_CARD,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 16,
    alignItems: "center",
  },
  modalSecondaryText: {
    color: TEXT_DARK_2,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  modalCancelButton: {
    borderRadius: RADIUS_CARD,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalCancelText: {
    color: MUTED_3,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
