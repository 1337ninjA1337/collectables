import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSocial } from "@/lib/social-context";

export const BOTTOM_NAV_HEIGHT = 58;

type NavItem = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  active: boolean;
};

type BottomNavProps = {
  onSearchPress?: () => void;
};

export function BottomNav({ onSearchPress }: BottomNavProps) {
  const pathname = usePathname();
  const { getMyProfile } = useSocial();
  const insets = useSafeAreaInsets();

  if (Platform.OS === "web") return null;

  const myProfile = getMyProfile();
  const onProfile = pathname.startsWith("/profile");
  const onSettings = pathname === "/settings";
  const onPeople = pathname.startsWith("/people");
  const onHome = pathname === "/";

  const items: NavItem[] = [
    {
      key: "home",
      icon: "home-outline",
      iconActive: "home",
      active: onHome,
      onPress: () => router.replace("/"),
    },
    {
      key: "search",
      icon: "search-outline",
      iconActive: "search",
      active: onPeople,
      onPress: () => router.push("/people"),
    },
    {
      key: "friends",
      icon: "people-outline",
      iconActive: "people",
      active: false,
      onPress: () => router.push("/people?tab=friends" as never),
    },
    {
      key: "profile",
      icon: "person-outline",
      iconActive: "person",
      active: onProfile,
      onPress: () => {
        if (myProfile) {
          router.push(`/profile/${myProfile.id}` as never);
        }
      },
    },
    {
      key: "settings",
      icon: "settings-outline",
      iconActive: "settings",
      active: onSettings,
      onPress: () => router.push("/settings"),
    },
  ];

  return (
    <View
      style={{
        ...styles.wrap,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      {items.map((item) => (
        <Pressable key={item.key} style={styles.item} onPress={item.onPress}>
          <Ionicons
            name={item.active ? item.iconActive : item.icon}
            size={26}
            color={item.active ? "#261b14" : "#8a6e54"}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    backgroundColor: "#fff7ef",
    borderTopWidth: 1,
    borderTopColor: "#eadbc8",
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
});
