import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/components/use-app-theme";
import { FriendsTabBadge, formatBadgeCount } from "@/lib/chat-helpers";
import {
  AMBER_ACCENT,
  DANGER,
  TEXT_ON_DARK,
} from "@/lib/design-tokens";
import { FONT_BODY_EXTRABOLD } from "@/lib/fonts";

export type NavItem = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  active: boolean;
  badge?: FriendsTabBadge;
  premiumBadge?: boolean;
};

function renderBadge(badge: FriendsTabBadge | undefined) {
  if (!badge || badge.kind === "none") return null;
  if (badge.kind === "dot") return <View style={styles.badge} />;
  return (
    <View style={styles.badgeCount}>
      <Text style={styles.badgeCountText}>{formatBadgeCount(badge.value)}</Text>
    </View>
  );
}

export function NavTab({ item }: { item: NavItem }) {
  const theme = useAppTheme();
  return (
    <Pressable style={styles.item} onPress={item.onPress}>
      <View style={styles.iconWrap}>
        <Ionicons
          name={item.active ? item.iconActive : item.icon}
          size={22}
          color={item.active ? theme.navIconActive : theme.navIconInactive}
        />
        {renderBadge(item.badge)}
        {item.premiumBadge ? <View style={styles.premiumDot} /> : null}
      </View>
      {item.active ? (
        <View style={{ ...styles.activeDot, backgroundColor: theme.navIconActive }} />
      ) : (
        <View style={styles.activeDotPlaceholder} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: DANGER,
    borderWidth: 1.5,
    borderColor: TEXT_ON_DARK,
  },
  badgeCount: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: DANGER,
    borderWidth: 1.5,
    borderColor: TEXT_ON_DARK,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeCountText: {
    color: TEXT_ON_DARK,
    fontSize: 10,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  iconWrap: {
    position: "relative",
  },
  premiumDot: {
    position: "absolute",
    bottom: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AMBER_ACCENT,
    borderWidth: 1.5,
    borderColor: TEXT_ON_DARK,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 3,
    alignSelf: "center",
  },
  activeDotPlaceholder: {
    width: 4,
    height: 4,
    marginTop: 3,
  },
});
