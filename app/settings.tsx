import { Stack, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { CurrencySheet } from "@/components/currency-sheet";
import { DangerSection } from "@/components/danger-section";
import { HeroBanner } from "@/components/hero-banner";
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
  COOL_GRAY,
  HERO_DARK,
  HERO_DARK_2,
  HERO_DARK_7,
  MUTED_2,
  MUTED_11,
  PURE_WHITE,
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
import { clearEntryCurrency, setEntryCurrency } from "@/lib/locale-helpers";
import { useEntryCurrency } from "@/lib/use-entry-currency";
import { useDiagnostics } from "@/lib/diagnostics-context";
import { AppLanguage, useI18n } from "@/lib/i18n-context";
import { getSentryStatus } from "@/lib/sentry";
import { useSocial } from "@/lib/social-context";
import { isPartiallyTranslated } from "@/lib/translation-status";
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
  // WHICH preference the one sheet is picking for. One mounted picker and a
  // target, rather than two sheets: the list, the search box and the modal are
  // identical, and a second `<CurrencySheet>` here would be the same component
  // twice with a different `onSelect` — the shape `currency-input-consistency`
  // exists to stop.
  const [currencySheetTarget, setCurrencySheetTarget] =
    useState<"display" | "entry">("display");
  const [refreshingRates, setRefreshingRates] = useState(false);
  // The OTHER currency preference. Splitting the storage key stopped a cost
  // form moving the display currency as a side effect, and left a second
  // preference no screen mentioned: a collector who displays in USD and types
  // in JPY saw "USD" here and a JPY chip on every add form, with nothing
  // connecting the two.
  //
  // Read as its own state rather than through the provider, because the
  // provider owns the DISPLAY currency and adding the entry one to it would
  // re-render every total on a change that cannot affect any of them.
  //
  // Through the hook rather than a read on mount: this screen and the two cost
  // forms all read one slot, and a stack keeps the others mounted while this
  // one is open. The hook re-reads on every write, so a currency picked here
  // reaches the add sheet sitting underneath rather than waiting for it to
  // remount.
  const entryCurrency = useEntryCurrency();

  const openCurrencySheet = useCallback((target: "display" | "entry") => {
    // The query is cleared on the way IN rather than on close, so a sheet
    // opened for the other preference does not arrive filtered by what
    // somebody typed the last time they opened this card.
    setCurrencyQuery("");
    setCurrencySheetTarget(target);
    setCurrencySheetOpen(true);
  }, []);

  const handleSelectCurrency = useCallback(
    (code: string) => {
      if (currencySheetTarget === "entry") {
        // No `.then(reload)`: the write notifies every reader of the slot and
        // this screen is one of them. Re-reading here as well would be a
        // second answer to a question already being asked.
        void setEntryCurrency(code);
      } else {
        setDisplayCurrency(code);
      }
      setCurrencySheetOpen(false);
    },
    [currencySheetTarget, setDisplayCurrency],
  );

  const handleUseDisplayCurrency = useCallback(() => {
    // Clearing, not writing `displayCurrency` into the slot: the empty state
    // means "follow the display currency", so writing today's value would pin
    // the forms to it and silently stop following a later change.
    void clearEntryCurrency();
  }, []);

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

      <HeroBanner eyebrow={t("settings")} title={t("settingsTitle")} />

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t("language")}</Text>
        <Text style={[styles.sectionText, { color: theme.meta }]}>{t("languageSubtitle")}</Text>
        <View style={styles.languageRow}>
          {languageOptions.map((option) => {
            // Four of the six locales sit below half — every locale map opens
            // with `...en`, so an untranslated key renders as English under
            // another flag. Listing them at the same weight as `ru` promises a
            // parity the app cannot keep, so the chip says so. The label is on
            // the Pressable rather than the badge: a badge a screen reader
            // announces after the language name is one a reader meets after
            // they have already chosen.
            const partial = isPartiallyTranslated(option.code);
            const active = language === option.code;
            return (
              <Pressable
                key={option.code}
                style={{...styles.languageChip, ...(active ? styles.languageChipActive : {})}}
                onPress={() => void setLanguage(option.code as AppLanguage)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  partial ? t("languagePartialHint", { label: option.label }) : option.label
                }
              >
                <Text style={{...styles.languageChipText, ...(active ? styles.languageChipTextActive : {})}}>
                  {option.label}
                </Text>
                {partial ? (
                  <Text
                    style={{...styles.languageChipBadge, ...(active ? styles.languageChipBadgeActive : {})}}
                  >
                    {t("languagePartial")}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t("displayCurrencyTitle")}</Text>
        <Text style={[styles.sectionText, { color: theme.meta }]}>{t("displayCurrencySubtitle")}</Text>
        <Pressable
          style={styles.currencyRow}
          onPress={() => {
            openCurrencySheet("display");
          }}
          accessibilityLabel={t("displayCurrencyTitle")}
          accessibilityRole="button"
        >
          <Text style={styles.currencyValue}>{displayCurrency}</Text>
          <Text style={styles.currencyChevron}>›</Text>
        </Pressable>
        {entryCurrency != null && entryCurrency !== displayCurrency ? (
          // The SURPRISE, still only when the two differ: a line saying "new
          // costs are entered in USD" under a display currency of USD is a
          // sentence about nothing. What changed is that the sentence is now a
          // way IN — tapping it opens the picker for the entry currency, which
          // the round that wrote this line left with no way to be set from
          // here at all.
          <>
            <Pressable
              onPress={() => {
                openCurrencySheet("entry");
              }}
              accessibilityRole="button"
              accessibilityLabel={t("entryCurrencyNotice", { currency: entryCurrency })}
            >
              <Text style={styles.entryCurrencyHint}>
                {t("entryCurrencyNotice", { currency: entryCurrency })}
                {" · "}
                {t("entryCurrencyChange")}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleUseDisplayCurrency}
              accessibilityRole="button"
              accessibilityLabel={t("entryCurrencyReset")}
            >
              <Text style={styles.entryCurrencyHint}>{t("entryCurrencyReset")}</Text>
            </Pressable>
          </>
        ) : (
          // And when they agree, the affordance without the claim. This is the
          // half that was missing: the preference could only be CREATED by
          // opening an add form and picking a currency there, so the one
          // screen that explains it could not change it in the direction that
          // brings it into existence. One quiet line, no second value shown —
          // the card's subject is still the display currency.
          <Pressable
            onPress={() => {
              openCurrencySheet("entry");
            }}
            accessibilityRole="button"
            accessibilityLabel={t("entryCurrencySet")}
          >
            <Text style={styles.entryCurrencyHint}>{t("entryCurrencySet")}</Text>
          </Pressable>
        )}
        {currencyRatesUpdatedAt != null ? (
          <Pressable onPress={handleRefreshRates} disabled={refreshingRates}
          accessibilityState={{ disabled: refreshingRates }}
            accessibilityRole="button"
          >
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
        // The entry sheet opens on the EFFECTIVE entry currency, which is the
        // display one until somebody chooses otherwise — `getEntryCurrency`
        // reads through, so a null slot is "follow the display currency" and
        // not "no currency".
        selectedCode={
          currencySheetTarget === "entry" ? (entryCurrency ?? displayCurrency) : displayCurrency
        }
        query={currencyQuery}
        onQueryChange={setCurrencyQuery}
        onSelect={handleSelectCurrency}
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
            <Pressable
              style={styles.premiumCancelButton}
              onPress={handleCancelPremium}
              accessibilityRole="button"
            >
              <Text style={styles.premiumCancelText}>{t("premiumCancel")}</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.premiumActivateButton}
              onPress={handleActivatePremium}
              accessibilityRole="button"
            >
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

      <DangerSection
        actionLabel={t("signOut")}
        onAction={() => void signOut()}
        disabled={pending}
      />

      <DangerSection
        tone="hard"
        title={t("deleteAccountSection")}
        hint={t("deleteAccountHint")}
        actionLabel={deleting ? t("deleteAccountDeleting") : t("deleteAccount")}
        onAction={handleDeleteAccount}
        disabled={pending || deleting}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  // Under the label rather than beside it: the chips wrap in a row, and a badge
  // on the same line widens `Беларуская` enough to push the row to three lines
  // on a narrow phone. Smaller and in the muted colour, so the language name
  // stays the thing being chosen and this stays the qualification on it.
  languageChipBadge: {
    marginTop: 2,
    fontSize: 11,
    color: MUTED_2,
    fontFamily: FONT_BODY,
  },
  languageChipBadgeActive: {
    color: TEXT_ON_DARK_SOFT,
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
  // The rates hint's shape — a sentence whose tail is the action — because it
  // is the same kind of line: a fact about the currency setup with one thing
  // you can do about it. MUTED_2 rather than the accent, because the rates
  // line is the one this card wants pressed and two amber lines under one row
  // would compete.
  entryCurrencyHint: {
    fontSize: 13,
    color: MUTED_2,
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
    color: PURE_WHITE,
    fontSize: 13,
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
