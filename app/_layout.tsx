import { Stack, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { LoginScreen } from "@/components/login-screen";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { CollectionsProvider } from "@/lib/collections-context";
import { I18nProvider, useI18n } from "@/lib/i18n-context";
import { SocialProvider } from "@/lib/social-context";
import { Screen } from "@/components/screen";

export default function RootLayout() {
  return (
    <I18nProvider>
      <AuthProvider>
        <SocialProvider>
          <CollectionsProvider>
            <AppShell />
          </CollectionsProvider>
        </SocialProvider>
      </AuthProvider>
    </I18nProvider>
  );
}

function AppShell() {
  const { ready, session } = useAuth();
  const { ready: i18nReady, t } = useI18n();
  const pathname = usePathname();

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

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
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
            pathname === "/" ? null : (
              <View style={styles.headerRightRow}>
                {pathname !== "/settings" ? (
                  <Pressable style={styles.headerButton} onPress={() => router.push("/settings")}>
                    <Text style={styles.headerButtonText}>{t("settings")}</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.homeButton} onPress={() => router.replace("/")}>
                  <Text style={styles.homeButtonText}>{t("goHome")}</Text>
                </Pressable>
              </View>
            ),
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
