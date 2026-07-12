import { LinearGradient } from "expo-linear-gradient";
import { Stack, router } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { CurrencySheet } from "@/components/currency-sheet";
import { Screen } from "@/components/screen";
import { useAppTheme } from "@/components/use-app-theme";
import { useAuth } from "@/lib/auth-context";
import { useCollections } from "@/lib/collections-context";
import {
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_SOFT,
  AMBER_SOFT_3,
  BORDER_5,
  BORDER_6,
  CARD_BG_3,
  CARD_BG_10,
  CARD_BG_11,
  COOL_GRAY,
  DANGER_DEEP_2,
  DANGER_DEEP_4,
  DANGER_DEEP_5,
  DANGER_MEDIUM,
  DANGER_SOFT_2,
  DANGER_SOFT_3,
  HERO_DARK,
  HERO_DARK_2,
  HERO_DARK_4,
  HERO_DARK_5,
  HERO_DARK_7,
  MUTED_2,
  MUTED_11,
  RADIUS_HERO_LG,
  RADIUS_ITEM_AIRY,
  RADIUS_PILL,
  SHADOW_SOFT,
  SPACING_CARD,
  SPACING_INLINE,
  SPACING_LIST,
  STATUS_ONLINE,
  TEXT_DARK_2,
  TEXT_ON_DARK,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { getAnalyticsEventCatalog } from "@/lib/analytics";
import { isDevEnvironment } from "@/lib/dev-menu";
import { useDiagnostics } from "@/lib/diagnostics-context";
import { AppLanguage, useI18n } from "@/lib/i18n-context";
import { getSentryStatus } from "@/lib/sentry";
import { useSocial } from "@/lib/social-context";
import { useNow } from "@/lib/use-now";
import { usePremium } from "@/lib/premium-context";
import { useToast } from "@/lib/toast-context";
import { FONT_DISPLAY, FONT_DISPLAY_EDITORIAL, FONT_BODY, FONT_BODY_BOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";

export default function SettingsScreen() {
  const theme = useAppTheme();
  const { t, language, setLanguage, languageOptions, formatRelativeDate, relativeDateLabel } = useI18n();
  const { signOut, deleteAccount, pending } = useAuth();
  const { ready: premiumReady, isPremium, activatedAt, expiresAt, activatePremium, cancelPremium } = usePremium();
  const { diagnosticsEnabled, setDiagnosticsEnabled } = useDiagnostics();
  const { isAdmin } = useSocial();
  const { displayCurrency, setDisplayCurrency, refreshCurrencyRates, currencyRatesUpdatedAt } =
    useCollections();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  // Minute tick so the "last sent N minutes ago" footer rolls over without
  // any other state change re-rendering the screen.
  useNow();
  const sentryStatus = getSentryStatus();
  const crashFooter = !diagnosticsEnabled
    ? t("diagnosticsCrashFooterDisabled")
    : sentryStatus.lastEventSentAt
      ? relativeDateLabel(
          t("diagnosticsCrashFooterLastSent"),
          formatRelativeDate(sentryStatus.lastEventSentAt),
        )
      : t("diagnosticsCrashFooterNoneSent");
  // Internal-only row: lets a tester verify their build was produced by a CI
  // run that inlined the Sentry secret, without opening devtools. Hidden from
  // regular production users (dev builds + admins only).
  const showDsnInlinedRow = isDevEnvironment() || isAdmin;
  // "What does this app track?" — the taxonomy list shares the internal-only
  // gate: power users (admins) and dev builds see it, regular users don't.
  const eventCatalog = getAnalyticsEventCatalog();
  const [eventsListOpen, setEventsListOpen] = useState(false);
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [currencyQuery, setCurrencyQuery] = useState("");
  const [refreshingRates, setRefreshingRates] = useState(false);

  async function handleRefreshRates() {
    if (refreshingRates) return;
    setRefreshingRates(true);
    try {
      await refreshCurrencyRates();
    } finally {
      setRefreshingRates(false);
    }
  }

  function handleActivatePremium() {
    activatePremium("settings");
    toast.success(t("premiumActivated"));
  }

  function handleCancelPremium() {
    const title = t("premiumConfirmCancelTitle");
    const message = t("premiumConfirmCancelText");
    if (Platform.OS === "web") {
      const confirmed = globalThis.confirm?.(`${title}\n\n${message}`) ?? false;
      if (!confirmed) return;
      cancelPremium();
      toast.success(t("premiumCanceled"));
      return;
    }
    Alert.alert(title, message, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("premiumCancel"),
        style: "destructive",
        onPress: () => {
          cancelPremium();
          toast.success(t("premiumCanceled"));
        },
      },
    ]);
  }

  function handleDeleteAccount() {
    const title = t("deleteAccountTitle");
    const message = t("deleteAccountText");

    if (Platform.OS === "web") {
      const confirmed = globalThis.confirm?.(`${title}\n\n${message}`) ?? false;
      if (confirmed) {
        void performDelete();
      }
      return;
    }

    Alert.alert(title, message, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("deleteAccountConfirm"),
        style: "destructive",
        onPress: () => void performDelete(),
      },
    ]);
  }

  async function performDelete() {
    setDeleting(true);
    try {
      const { error } = await deleteAccount();
      if (error) {
        if (Platform.OS === "web") {
          globalThis.alert?.(t("deleteAccountFailed"));
        } else {
          Alert.alert(t("deleteAccountFailed"));
        }
      } else {
        router.replace("/");
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t("settings") }} />

      <LinearGradient
        colors={[HERO_DARK_4, HERO_DARK, HERO_DARK_5]}
        start={{ x: 0.2, y: 0.6 }}
        end={{ x: 1, y: 0 }}
        style={styles.hero}
      >
        <Text style={styles.eyebrow}>{t("settings")}</Text>
        <Text style={styles.title}>{t("settingsTitle")}</Text>
      </LinearGradient>

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t("language")}</Text>
        <Text style={[styles.sectionText, { color: theme.meta }]}>{t("languageSubtitle")}</Text>
        <View style={styles.languageRow}>
          {languageOptions.map((option) => (
            <Pressable
              key={option.code}
              style={{...styles.languageChip, ...(language === option.code ? styles.languageChipActive : {})}}
              onPress={() => void setLanguage(option.code as AppLanguage)}
            >
              <Text style={{...styles.languageChipText, ...(language === option.code ? styles.languageChipTextActive : {})}}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t("displayCurrencyTitle")}</Text>
        <Text style={[styles.sectionText, { color: theme.meta }]}>{t("displayCurrencySubtitle")}</Text>
        <Pressable
          style={styles.currencyRow}
          onPress={() => {
            setCurrencyQuery("");
            setCurrencySheetOpen(true);
          }}
          accessibilityLabel={t("displayCurrencyTitle")}
        >
          <Text style={styles.currencyValue}>{displayCurrency}</Text>
          <Text style={styles.currencyChevron}>›</Text>
        </Pressable>
        {currencyRatesUpdatedAt != null ? (
          <Pressable onPress={handleRefreshRates} disabled={refreshingRates}>
            <Text style={styles.ratesHint}>
              {t("currencyRatesUpdated", {
                when: formatRelativeDate(new Date(currencyRatesUpdatedAt).toISOString()),
              })}
              {" · "}
              {t("currencyRatesRefresh")}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.ratesUnavailable}>{t("currencyRatesUnavailable")}</Text>
        )}
      </View>

      <CurrencySheet
        visible={currencySheetOpen}
        selectedCode={displayCurrency}
        query={currencyQuery}
        onQueryChange={setCurrencyQuery}
        onSelect={(code) => {
          setDisplayCurrency(code);
          setCurrencySheetOpen(false);
        }}
        onClose={() => setCurrencySheetOpen(false)}
      />

      {premiumReady ? (
        <View style={isPremium ? styles.premiumCardActive : [styles.premiumCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.premiumHeaderRow}>
            <Text style={isPremium ? styles.premiumSectionTitleActive : [styles.premiumSectionTitle, { color: theme.text }]}>
              {t("premiumTitle")}
            </Text>
            {isPremium ? (
              <View style={styles.premiumBadge}>
                <Text style={styles.premiumBadgeText}>{t("premiumActive")}</Text>
              </View>
            ) : null}
          </View>
          <Text style={isPremium ? styles.premiumSubtitleActive : [styles.premiumSubtitle, { color: theme.meta }]}>
            {isPremium && activatedAt
              ? t("premiumActiveSince", { date: formatRelativeDate(activatedAt) })
              : t("premiumSubtitle")}
          </Text>
          {isPremium && expiresAt ? (
            <Text style={styles.premiumRenewsLine}>
              {t("premiumRenewsOn", { date: expiresAt.slice(0, 10) })}
            </Text>
          ) : null}
          <View style={styles.premiumBenefits}>
            {(["premiumBenefit1", "premiumBenefit2", "premiumBenefit3"] as const).map((key) => (
              <View key={key} style={styles.premiumBenefitRow}>
                <Text style={styles.premiumBenefitDot}>✦</Text>
                <Text style={isPremium ? styles.premiumBenefitTextActive : [styles.premiumBenefitText, { color: theme.text }]}>
                  {t(key)}
                </Text>
              </View>
            ))}
          </View>
          {isPremium ? (
            <Pressable style={styles.premiumCancelButton} onPress={handleCancelPremium}>
              <Text style={styles.premiumCancelText}>{t("premiumCancel")}</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.premiumActivateButton} onPress={handleActivatePremium}>
              <Text style={styles.premiumActivateText}>{t("premiumActivate")}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={[styles.premiumCardSkeleton, { backgroundColor: theme.card, borderColor: theme.border }]} testID="premium-card-skeleton">
          <View style={styles.premiumSkeletonTitle} />
          <View style={styles.premiumSkeletonLine} />
          <View style={styles.premiumSkeletonLineShort} />
          <View style={styles.premiumSkeletonButton} />
        </View>
      )}

      <View style={styles.diagnosticsCard}>
        <Text style={styles.diagnosticsTitle}>{t("diagnosticsTitle")}</Text>
        <Text style={styles.diagnosticsHint}>{t("diagnosticsHint")}</Text>
        <Pressable
          style={[
            styles.diagnosticsToggle,
            diagnosticsEnabled
              ? styles.diagnosticsToggleOn
              : styles.diagnosticsToggleOff,
          ]}
          onPress={() => setDiagnosticsEnabled(!diagnosticsEnabled)}
          accessibilityRole="switch"
          accessibilityState={{ checked: diagnosticsEnabled }}
        >
          <Text style={styles.diagnosticsToggleText}>
            {diagnosticsEnabled
              ? t("diagnosticsEnabled")
              : t("diagnosticsDisabled")}
          </Text>
        </Pressable>
        <Text style={styles.diagnosticsFooter} testID="diagnostics-crash-footer">
          {crashFooter}
        </Text>
        {showDsnInlinedRow && (
          <Text style={styles.diagnosticsFooter} testID="diagnostics-dsn-inlined">
            {`${t("diagnosticsDsnInlined")}: ${sentryStatus.dsnPresent ? "✅" : "❌"}`}
          </Text>
        )}
        {showDsnInlinedRow && (
          <>
            <Pressable
              onPress={() => setEventsListOpen(!eventsListOpen)}
              accessibilityRole="button"
              accessibilityState={{ expanded: eventsListOpen }}
              testID="diagnostics-events-toggle"
            >
              <Text style={styles.diagnosticsEventsToggle}>
                {`${t("diagnosticsEventsTitle")} (${eventCatalog.length}) ${eventsListOpen ? "▴" : "▾"}`}
              </Text>
            </Pressable>
            {eventsListOpen &&
              eventCatalog.map((event) => (
                <View
                  key={event.name}
                  style={styles.diagnosticsEventRow}
                  testID={`diagnostics-event-${event.name}`}
                >
                  <Text style={styles.diagnosticsEventName}>{event.name}</Text>
                  <Text style={styles.diagnosticsEventDescription}>
                    {event.description}
                  </Text>
                  <Text style={styles.diagnosticsEventProps}>
                    {event.props.join(" · ")}
                  </Text>
                </View>
              ))}
          </>
        )}
      </View>

      <Pressable
        style={{...styles.signOutButton, ...(pending ? styles.signOutButtonDisabled : {})}}
        onPress={() => void signOut()}
        disabled={pending}
      >
        <Text style={styles.signOutButtonText}>{t("signOut")}</Text>
      </Pressable>

      <View style={styles.dangerZone}>
        <Text style={styles.dangerTitle}>{t("deleteAccountSection")}</Text>
        <Text style={styles.dangerText}>{t("deleteAccountHint")}</Text>
        <Pressable
          style={{...styles.deleteButton, ...((pending || deleting) ? styles.deleteButtonDisabled : {})}}
          onPress={handleDeleteAccount}
          disabled={pending || deleting}
        >
          <Text style={styles.deleteButtonText}>
            {deleting ? t("deleteAccountDeleting") : t("deleteAccount")}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: RADIUS_HERO_LG,
    padding: 24,
    gap: SPACING_LIST,
  },
  eyebrow: {
    color: AMBER_LIGHT,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  title: {
    color: TEXT_ON_DARK_3,
    fontSize: 28,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY_EDITORIAL,
    lineHeight: 36,
  },
  card: {
    borderRadius: RADIUS_ITEM_AIRY,
    borderWidth: 1,
    padding: 18,
    gap: SPACING_CARD,
    ...SHADOW_SOFT,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  sectionText: {
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING_LIST,
  },
  languageChip: {
    borderRadius: RADIUS_PILL,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  languageChipActive: {
    backgroundColor: HERO_DARK,
    borderColor: HERO_DARK,
  },
  languageChipText: {
    color: HERO_DARK_2,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  languageChipTextActive: {
    color: TEXT_ON_DARK_4,
  },
  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  currencyValue: {
    fontSize: 17,
    fontWeight: "800",
    color: HERO_DARK,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  currencyChevron: {
    fontSize: 20,
    color: AMBER_ACCENT,
    fontWeight: "800",
  },
  ratesHint: {
    fontSize: 13,
    color: AMBER_ACCENT,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  ratesUnavailable: {
    fontSize: 13,
    color: MUTED_2,
    fontStyle: "italic",
    fontFamily: FONT_BODY,
  },
  diagnosticsCard: {
    backgroundColor: TEXT_ON_DARK,
    borderRadius: RADIUS_ITEM_AIRY,
    borderWidth: 1,
    borderColor: AMBER_SOFT_3,
    padding: 16,
    gap: SPACING_INLINE,
    marginVertical: 4,
  },
  diagnosticsTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: HERO_DARK,
    fontFamily: FONT_DISPLAY,
  },
  diagnosticsHint: {
    fontSize: 13,
    color: MUTED_11,
    lineHeight: 18,
    fontFamily: FONT_BODY,
  },
  diagnosticsFooter: {
    fontSize: 12,
    color: MUTED_11,
    fontStyle: "italic",
    fontFamily: FONT_BODY,
    marginTop: 2,
  },
  diagnosticsEventsToggle: {
    fontSize: 12,
    fontWeight: "800",
    color: HERO_DARK,
    fontFamily: FONT_BODY_EXTRABOLD,
    marginTop: 4,
  },
  diagnosticsEventRow: {
    gap: 2,
    marginTop: 6,
  },
  diagnosticsEventName: {
    fontSize: 12,
    fontWeight: "800",
    color: HERO_DARK,
    fontFamily: FONT_BODY_BOLD,
  },
  diagnosticsEventDescription: {
    fontSize: 12,
    color: MUTED_11,
    lineHeight: 16,
    fontFamily: FONT_BODY,
  },
  diagnosticsEventProps: {
    fontSize: 11,
    color: MUTED_11,
    fontStyle: "italic",
    fontFamily: FONT_BODY,
  },
  diagnosticsToggle: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS_PILL,
    marginTop: 4,
  },
  diagnosticsToggleOn: {
    backgroundColor: STATUS_ONLINE,
  },
  diagnosticsToggleOff: {
    backgroundColor: COOL_GRAY,
  },
  diagnosticsToggleText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  signOutButton: {
    borderRadius: RADIUS_PILL,
    borderWidth: 1,
    borderColor: DANGER_SOFT_2,
    backgroundColor: CARD_BG_10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutButtonText: {
    color: DANGER_DEEP_4,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  dangerZone: {
    borderRadius: RADIUS_ITEM_AIRY,
    backgroundColor: CARD_BG_11,
    borderWidth: 1,
    borderColor: DANGER_SOFT_3,
    padding: 18,
    gap: SPACING_CARD,
  },
  dangerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: DANGER_DEEP_5,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  dangerText: {
    color: DANGER_MEDIUM,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  deleteButton: {
    alignSelf: "flex-start",
    borderRadius: RADIUS_PILL,
    backgroundColor: DANGER_DEEP_2,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    color: TEXT_ON_DARK_4,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  premiumCard: {
    borderRadius: RADIUS_ITEM_AIRY,
    borderWidth: 1,
    padding: 18,
    gap: SPACING_CARD,
    ...SHADOW_SOFT,
  },
  premiumCardActive: {
    borderRadius: RADIUS_ITEM_AIRY,
    backgroundColor: HERO_DARK_7,
    borderWidth: 1,
    borderColor: AMBER_ACCENT,
    padding: 18,
    gap: SPACING_CARD,
  },
  premiumHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING_LIST,
  },
  premiumSectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  premiumSectionTitleActive: {
    fontSize: 22,
    fontWeight: "800",
    color: TEXT_ON_DARK_3,
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  premiumBadge: {
    borderRadius: RADIUS_PILL,
    backgroundColor: AMBER_ACCENT,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  premiumBadgeText: {
    color: TEXT_DARK_2,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  premiumSubtitle: {
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  premiumSubtitleActive: {
    color: TEXT_ON_DARK_SOFT,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  premiumRenewsLine: {
    color: AMBER_LIGHT,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
    marginTop: -4,
  },
  premiumBenefits: {
    gap: SPACING_INLINE,
    marginTop: 4,
  },
  premiumBenefitRow: {
    flexDirection: "row",
    gap: SPACING_LIST,
    alignItems: "flex-start",
  },
  premiumBenefitDot: {
    color: AMBER_ACCENT,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
    lineHeight: 22,
  },
  premiumBenefitText: {
    flex: 1,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  premiumBenefitTextActive: {
    flex: 1,
    color: TEXT_ON_DARK,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  premiumActivateButton: {
    borderRadius: RADIUS_PILL,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  premiumActivateText: {
    color: TEXT_DARK_2,
    fontSize: 15,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  premiumCancelButton: {
    borderRadius: RADIUS_PILL,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  premiumCancelText: {
    color: TEXT_ON_DARK,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  premiumCardSkeleton: {
    borderRadius: RADIUS_ITEM_AIRY,
    borderWidth: 1,
    padding: 18,
    gap: SPACING_CARD,
    minHeight: 220,
  },
  premiumSkeletonTitle: {
    height: 22,
    width: "45%",
    borderRadius: 8,
    backgroundColor: BORDER_5,
  },
  premiumSkeletonLine: {
    height: 14,
    width: "85%",
    borderRadius: 6,
    backgroundColor: BORDER_6,
  },
  premiumSkeletonLineShort: {
    height: 14,
    width: "60%",
    borderRadius: 6,
    backgroundColor: BORDER_6,
  },
  premiumSkeletonButton: {
    height: 44,
    borderRadius: RADIUS_PILL,
    backgroundColor: BORDER_5,
    marginTop: 8,
  },
});
