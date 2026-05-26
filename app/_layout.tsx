import "react-native-gesture-handler";

import { ErrorBoundary } from "@sentry/react-native";
import * as Sentry from "@sentry/react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { Stack, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { BottomNav } from "@/components/bottom-nav";
import { CrashFallback } from "@/components/crash-fallback";
import { LoginScreen } from "@/components/login-screen";
import { NavigationBreadcrumbs } from "@/components/navigation-breadcrumbs";
import { SearchOverlay } from "@/components/search-overlay";
import { AnalyticsProvider } from "@/lib/analytics-provider";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ChatProvider, useChat } from "@/lib/chat-context";
import { formatBadgeCount } from "@/lib/chat-helpers";
import { CollectionsProvider } from "@/lib/collections-context";
import {
  ACCENT_DEEP,
  AMBER_SOFT,
  CARD_BG_3,
  DANGER,
  HERO_DARK,
  HERO_DARK_2,
  MUTED_9,
  PAGE_BG_2,
  STATUS_OFFLINE,
  STATUS_ONLINE,
  TEXT_DARK,
  TEXT_ON_DARK,
  TEXT_ON_DARK_4,
} from "@/lib/design-tokens";
import { DiagnosticsProvider } from "@/lib/diagnostics-context";
import { isDevEnvironment, loadDevMenuModule, registerDevMenu } from "@/lib/dev-menu";
import { I18nProvider, useI18n, useOptionalI18n } from "@/lib/i18n-context";
import { MarketplaceProvider } from "@/lib/marketplace-context";
import { PremiumProvider } from "@/lib/premium-context";
import { NavAnimationProvider, useNavAnimation } from "@/lib/nav-animation-context";
import { RealtimeStatusProvider } from "@/lib/realtime-status-context";
import { getSentryStatus, triggerSentryTestError } from "@/lib/sentry";
import { SocialProvider } from "@/lib/social-context";
import { clearRuntimeSupabaseConfig } from "@/lib/supabase";
import { ToastProvider } from "@/lib/toast-context";
import { Screen, useResponsive } from "@/components/screen";
import { FONT_DISPLAY, FONT_DISPLAY_BOLD, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";

export default Sentry.wrap(function RootLayout() {
  useEffect(() => {
    // SDK init now happens inside DiagnosticsProvider after hydrating the
    // stored opt-in/opt-out flag, so the user's choice is honoured before
    // any event is captured. We only register devtools globals here.
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.__sendSentryTestError = triggerSentryTestError;
    scope.__sentryStatus = getSentryStatus;
  }, []);

  useEffect(() => {
    if (!isDevEnvironment()) return;
    registerDevMenu({
      isDev: true,
      globalScope: globalThis as unknown as Record<string, unknown>,
      devMenu: loadDevMenuModule(),
      actions: {
        clearRuntimeSupabaseConfig: {
          label: "Clear runtime Supabase config",
          run: clearRuntimeSupabaseConfig,
        },
      },
    });
  }, []);

  const [fontsLoaded] = useFonts({
    [FONT_DISPLAY_BOLD]: require("../assets/fonts/Syne/static/Syne-Bold.ttf"),
    [FONT_DISPLAY]: require("../assets/fonts/Syne/static/Syne-ExtraBold.ttf"),
    [FONT_BODY]: require("../assets/fonts/DM_Sans/static/DMSans-Regular.ttf"),
    [FONT_BODY_SEMIBOLD]: require("../assets/fonts/DM_Sans/static/DMSans-SemiBold.ttf"),
    [FONT_BODY_BOLD]: require("../assets/fonts/DM_Sans/static/DMSans-Bold.ttf"),
    [FONT_BODY_EXTRABOLD]: require("../assets/fonts/DM_Sans/static/DMSans-ExtraBold.ttf"),
  });

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary
      fallback={({ error, resetError }) => (
        <LocalizedCrashFallback error={error} resetError={resetError} />
      )}
    >
      <I18nProvider>
        <DiagnosticsProvider>
          <ToastProvider>
            <RealtimeStatusProvider>
              <AuthProvider>
                <SocialProvider>
                  <CollectionsProvider>
                    <ChatProvider>
                      <MarketplaceProvider>
                        <PremiumProvider>
                          <AnalyticsProvider>
                            <NavAnimationProvider>
                              <AppShell />
                            </NavAnimationProvider>
                          </AnalyticsProvider>
                        </PremiumProvider>
                      </MarketplaceProvider>
                    </ChatProvider>
                  </CollectionsProvider>
                </SocialProvider>
              </AuthProvider>
            </RealtimeStatusProvider>
          </ToastProvider>
        </DiagnosticsProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
});

function AppShell() {
  const { ready, session } = useAuth();
  const { ready: i18nReady, t } = useI18n();
  const { animation } = useNavAnimation();
  const { unreadTotal, realtimeOnline } = useChat();
  const pathname = usePathname();
  const { isMobile } = useResponsive();
  const [searchOpen, setSearchOpen] = useState(false);

  if (!ready || !i18nReady) {
    return (
      <Screen scroll={false}>
        <StatusBar style="dark" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={ACCENT_DEEP} />
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

  const showMobileNav = isMobile;

  return (
    <GestureHandlerRootView style={styles.shell}>
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <NavigationBreadcrumbs />
      <View style={styles.stackWrap}>
        <Stack
          screenOptions={{
            animation,
            headerBackVisible: !showMobileNav,
            headerShadowVisible: false,
            headerStyle: {
              backgroundColor: TEXT_ON_DARK,
            },
            headerTintColor: TEXT_DARK,
            contentStyle: {
              backgroundColor: PAGE_BG_2,
            },
            headerTitleStyle: {
              fontWeight: "700",
            },
            headerRight: () =>
              showMobileNav ? null : (
                <View style={styles.headerRightRow}>
                  {pathname !== "/settings" && pathname !== "/" ? (
                    <Pressable style={styles.headerButton} onPress={() => router.push("/settings")}>
                      <Text style={styles.headerButtonText}>{t("settings")}</Text>
                    </Pressable>
                  ) : null}
                  {!pathname.startsWith("/chats") && !pathname.startsWith("/chat/") ? (
                    <Pressable
                      style={styles.headerIconButton}
                      onPress={() => router.push("/chats")}
                      accessibilityLabel={t("chatsTitle")}
                    >
                      <Ionicons name="chatbubbles-outline" size={18} color={HERO_DARK_2} />
                      <View style={[styles.realtimeDot, realtimeOnline ? styles.realtimeDotOnline : styles.realtimeDotOffline]} />
                      {unreadTotal > 0 ? (
                        <View style={styles.headerBadge}>
                          <Text style={styles.headerBadgeText}>{formatBadgeCount(unreadTotal)}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.headerIconButton}
                    onPress={() => setSearchOpen(true)}
                    accessibilityLabel={t("searchPlaceholder")}
                  >
                    <Ionicons name="search" size={18} color={HERO_DARK_2} />
                  </Pressable>
                  {pathname !== "/chats" ? (
                    <Pressable
                      style={styles.headerIconButton}
                      onPress={() => router.push("/chats")}
                      accessibilityLabel={t("chatsTitle")}
                    >
                      <Ionicons name="chatbubbles-outline" size={18} color={HERO_DARK_2} />
                      <View style={[styles.realtimeDot, realtimeOnline ? styles.realtimeDotOnline : styles.realtimeDotOffline]} />
                      {unreadTotal > 0 ? (
                        <View style={styles.headerBadge}>
                          <Text style={styles.headerBadgeText}>{formatBadgeCount(unreadTotal)}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ) : null}
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

function LocalizedCrashFallback({
  error,
  resetError,
}: {
  error: unknown;
  resetError?: () => void;
}) {
  const i18n = useOptionalI18n();
  const t = i18n
    ? (key: string) => {
        const result = (i18n.t as (k: string) => string)(key);
        return typeof result === "string" ? result : key;
      }
    : undefined;
  return <CrashFallback error={error} resetError={resetError} t={t} />;
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: PAGE_BG_2,
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
    color: MUTED_9,
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
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  headerIconButton: {
    borderRadius: 999,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  realtimeDot: {
    position: "absolute",
    bottom: 3,
    right: 3,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: TEXT_ON_DARK,
  },
  realtimeDotOnline: {
    backgroundColor: STATUS_ONLINE,
  },
  realtimeDotOffline: {
    backgroundColor: STATUS_OFFLINE,
  },
  headerBadge: {
    position: "absolute",
    top: -4,
    right: -6,
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
  headerBadgeText: {
    color: TEXT_ON_DARK,
    fontSize: 10,
    fontWeight: "800",
  },
  headerButtonText: {
    color: HERO_DARK_2,
    fontSize: 13,
    fontWeight: "800",
  },
  homeButton: {
    borderRadius: 999,
    backgroundColor: HERO_DARK,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  homeButtonText: {
    color: TEXT_ON_DARK_4,
    fontSize: 13,
    fontWeight: "800",
  },
});
