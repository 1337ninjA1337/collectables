// FIRST, and that is the gesture-handler rule rather than a style choice: on
// native this module runs `import "react-native-gesture-handler"` for its side
// effects, which the library asks for at the top of the entry file, before
// anything else is imported. It was literally the first line of this file
// until the platform split moved it one module down; keeping the import here
// keeps the ordering the split was not meant to change.
//
// Platform-split: `GestureHandlerRootView` plus that side-effect import on
// native, a plain `<View>` on web. Nothing on web mounts a gesture-handler
// component — the reorder list has its own web shim — and the import alone was
// carrying reanimated, worklets and hammerjs into the bundle: 964 KiB, a fifth
// of what the deployed site downloads. See `components/gesture-root.web.tsx`.
import { GestureRoot } from "@/components/gesture-root";

// The crash shell is a platform pair for the same reason the gesture root is:
// the root imported `@sentry/react-native` at module scope for `wrap()` and
// `<ErrorBoundary>`, and that import put 838 KiB of SDK — replay and feedback
// included, which nothing here calls — into every web page load, while
// `lib/sentry.ts` was carefully loading the same SDK lazily. Native keeps
// Sentry's own boundary; web has one of its own that reports through
// `@/lib/sentry`. See `components/crash-boundary.web.tsx`.
import { CrashBoundary, withCrashReporting } from "@/components/crash-boundary";
import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { Stack, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { BottomNav } from "@/components/bottom-nav";
import { CrashFallback } from "@/components/crash-fallback";
import { LoginScreen } from "@/components/login-screen";
import { NavigationBreadcrumbs } from "@/components/navigation-breadcrumbs";
import { SearchOverlay } from "@/components/search-overlay";
import { SoldListingPrompt } from "@/components/sold-listing-prompt";
import { StorageNotice } from "@/components/storage-notice";
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
  RADIUS_PILL,
  SPACING_CARD,
  SPACING_INLINE,
  STATUS_OFFLINE,
  STATUS_ONLINE,
  TEXT_DARK,
  TEXT_ON_DARK,
  TEXT_ON_DARK_4,
} from "@/lib/design-tokens";
import { DiagnosticsProvider } from "@/lib/diagnostics-context";
import { getAnalyticsStatus, simulateSignupEvent } from "@/lib/analytics";
import { isDevEnvironment, loadDevMenuModule, registerDevMenu } from "@/lib/dev-menu";
import { I18nProvider, useI18n, useOptionalI18n } from "@/lib/i18n-context";
import { MarketplaceProvider } from "@/lib/marketplace-context";
import { PremiumProvider } from "@/lib/premium-context";
import { NavAnimationProvider, useNavAnimation } from "@/lib/nav-animation-context";
import { RealtimeStatusProvider } from "@/lib/realtime-status-context";
import { ensureLiveRegion } from "@/lib/announce";
import { getSentryStatus, triggerSentryTestError } from "@/lib/sentry";
import { SocialProvider } from "@/lib/social-context";
import { clearAllCollectablesStorage } from "@/lib/storage-keys";
import { clearRuntimeSupabaseConfig } from "@/lib/supabase";
import { ToastProvider } from "@/lib/toast-context";
import { Screen, useResponsive } from "@/components/screen";
import { SyncStatusPill } from "@/components/sync-status-pill";
import { FONT_DISPLAY, FONT_DISPLAY_BOLD, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";

export default withCrashReporting(function RootLayout() {
  useEffect(() => {
    // SDK init now happens inside DiagnosticsProvider after hydrating the
    // stored opt-in/opt-out flag, so the user's choice is honoured before
    // any event is captured. We only register devtools globals here.
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.__sendSentryTestError = triggerSentryTestError;
    scope.__sentryStatus = getSentryStatus;
    scope.__analyticsStatus = getAnalyticsStatus;
  }, []);

  useEffect(() => {
    // Screen-reader announcements speak through an ARIA live region on web,
    // and a region created at the moment of the first announcement can be
    // missed by a reader that has not scanned that subtree yet. Mounting it
    // empty at startup removes the race; on native this is a no-op.
    ensureLiveRegion();
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
        resetCollectablesStorage: {
          label: "Reset Collectables storage",
          run: () => {
            void clearAllCollectablesStorage();
          },
        },
        simulateSignupEvent: {
          label: "Simulate signup event",
          // Attached as globalThis.__simulateSignupEvent — returning the
          // status snapshot lets a console caller see which gate (if any)
          // blocked the capture.
          run: simulateSignupEvent,
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
    <CrashBoundary
      fallback={({ error, resetError }) => (
        <LocalizedCrashFallback error={error} resetError={resetError} />
      )}
    >
      <I18nProvider>
        <DiagnosticsProvider>
          <ToastProvider>
            {/* One subscriber for every rejected write in the tree, above the
                auth gate so a sign-out does not unmount it. */}
            <StorageNotice />
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
    </CrashBoundary>
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

  /**
   * The header's chat button draws an unread pill INSIDE the `<Pressable>`
   * that names it, so the pill reached no screen reader — the same hole the
   * bottom nav's chats tab had, in the header that ships on every screen. The
   * `<Pressable>` carries a label, which on iOS replaces its children entirely,
   * so the count has to go into the label rather than beside it.
   *
   * Declared once because the button below is written out twice, under two
   * mutually exclusive path conditions; the label was the only part of the two
   * blocks that had any reason to differ, and it does not.
   */
  const chatsA11yLabel =
    unreadTotal > 0 ? t("navChatsUnreadA11y", { count: unreadTotal }) : t("chatsTitle");

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
    <GestureRoot style={styles.shell}>
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <NavigationBreadcrumbs />
      <SyncStatusPill />
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
                    <Pressable
                      style={styles.headerButton}
                      onPress={() => router.push("/settings")}
                      accessibilityRole="button"
                    >
                      <Text style={styles.headerButtonText}>{t("settings")}</Text>
                    </Pressable>
                  ) : null}
                  {!pathname.startsWith("/chats") && !pathname.startsWith("/chat/") ? (
                    <Pressable
                      style={styles.headerIconButton}
                      onPress={() => router.push("/chats")}
                      accessibilityLabel={chatsA11yLabel}
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name="chatbubbles-outline"
                        size={18}
                        color={HERO_DARK_2}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        aria-hidden
                      />
                      <View style={[styles.realtimeDot, realtimeOnline ? styles.realtimeDotOnline : styles.realtimeDotOffline]} />
                      {unreadTotal > 0 ? (
                        <View
                          style={styles.headerBadge}
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                          aria-hidden
                        >
                          <Text style={styles.headerBadgeText}>{formatBadgeCount(unreadTotal)}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.headerIconButton}
                    onPress={() => setSearchOpen(true)}
                    accessibilityLabel={t("searchPlaceholder")}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="search"
                      size={18}
                      color={HERO_DARK_2}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                      aria-hidden
                    />
                  </Pressable>
                  {pathname !== "/chats" ? (
                    <Pressable
                      style={styles.headerIconButton}
                      onPress={() => router.push("/chats")}
                      accessibilityLabel={chatsA11yLabel}
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name="chatbubbles-outline"
                        size={18}
                        color={HERO_DARK_2}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        aria-hidden
                      />
                      <View style={[styles.realtimeDot, realtimeOnline ? styles.realtimeDotOnline : styles.realtimeDotOffline]} />
                      {unreadTotal > 0 ? (
                        <View
                          style={styles.headerBadge}
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                          aria-hidden
                        >
                          <Text style={styles.headerBadgeText}>{formatBadgeCount(unreadTotal)}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ) : null}
                  {pathname !== "/" ? (
                    <Pressable
                      style={styles.homeButton}
                      onPress={() => router.replace("/")}
                      accessibilityRole="button"
                    >
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
      <SoldListingPrompt />
    </View>
    </GestureRoot>
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
    gap: SPACING_CARD,
  },
  loadingText: {
    color: MUTED_9,
    fontSize: 15,
  },
  headerRightRow: {
    flexDirection: "row",
    gap: SPACING_INLINE,
    marginRight: 20,
    alignItems: "center",
  },
  headerButton: {
    borderRadius: RADIUS_PILL,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  headerIconButton: {
    borderRadius: RADIUS_PILL,
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
    borderRadius: RADIUS_PILL,
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
