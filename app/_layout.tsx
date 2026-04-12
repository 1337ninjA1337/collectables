import "react-native-gesture-handler";

import { Ionicons } from "@expo/vector-icons";
import { Stack, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { BottomNav } from "@/components/bottom-nav";
import { LoginScreen } from "@/components/login-screen";
import { SearchOverlay } from "@/components/search-overlay";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { CollectionsProvider } from "@/lib/collections-context";
import { I18nProvider, useI18n } from "@/lib/i18n-context";
import { NavAnimationProvider, useNavAnimation } from "@/lib/nav-animation-context";
import { SocialProvider } from "@/lib/social-context";
import { ToastProvider } from "@/lib/toast-context";
import { Screen } from "@/components/screen";

export default function RootLayout() {
  return (
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <SocialProvider>
            <CollectionsProvider>
              <NavAnimationProvider>
                <AppShell />
              </NavAnimationProvider>
            </CollectionsProvider>
          </SocialProvider>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

function AppShell() {
  const { ready, session } = useAuth();
  const { ready: i18nReady, t } = useI18n();
  const { animation } = useNavAnimation();
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);

  if (!ready || !i18nReady) {
    return (
      <Screen scroll={false}>
        <StatusBar style="dark" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#8a5a2b" />
          <Text style={styles.loadingText}>{t("checkingSession")}</Text>
        </View>
      </Screen>
    );
  }

  if (!session) {
    if (pathname === "/auth/callback") {
      return (
        <>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </>
      );
    }

    return (
      <>
        <StatusBar style="dark" />
        <LoginScreen />
      </>
    );
  }

  const isNative = Platform.OS !== "web";

  return (
    <GestureHandlerRootView style={styles.shell}>
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.stackWrap}>
        <Stack
          screenOptions={{
            animation,
            headerBackVisible: !isNative,
            headerShadowVisible: false,
            headerStyle: {
              backgroundColor: "#fff7ef",
            },
            headerTintColor: "#2f2318",
            contentStyle: {
              backgroundColor: "#fffaf4",
            },
            headerTitleStyle: {
              fontWeight: "700",
            },
            headerRight: () =>
              isNative ? null : (
                <View style={styles.headerRightRow}>
                  {pathname !== "/settings" && pathname !== "/" ? (
                    <Pressable style={styles.headerButton} onPress={() => router.push("/settings")}>
                      <Text style={styles.headerButtonText}>{t("settings")}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.headerIconButton}
                    onPress={() => setSearchOpen(true)}
                    accessibilityLabel={t("searchPlaceholder")}
                  >
                    <Ionicons name="search" size={18} color="#2a1d15" />
                  </Pressable>
                  {pathname !== "/" ? (
                    <Pressable style={styles.homeButton} onPress={() => router.replace("/")}>
                      <Text style={styles.homeButtonText}>{t("goHome")}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ),
          }}
        />
      </View>
      <BottomNav onSearchPress={() => setSearchOpen(true)} />
      <SearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />
    </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#fffaf4",
  },
  stackWrap: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: "#6d5645",
    fontSize: 15,
  },
  headerRightRow: {
    flexDirection: "row",
    gap: 8,
    marginRight: 20,
    alignItems: "center",
  },
  headerButton: {
    borderRadius: 999,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  headerIconButton: {
    borderRadius: 999,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtonText: {
    color: "#2a1d15",
    fontSize: 13,
    fontWeight: "800",
  },
  homeButton: {
    borderRadius: 999,
    backgroundColor: "#261b14",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  homeButtonText: {
    color: "#fff4e8",
    fontSize: 13,
    fontWeight: "800",
  },
});
