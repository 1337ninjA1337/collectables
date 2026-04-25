import { Stack, router } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/screen";
import { useAuth } from "@/lib/auth-context";
import { AppLanguage, useI18n } from "@/lib/i18n-context";
import { usePremium } from "@/lib/premium-context";
import { useToast } from "@/lib/toast-context";

export default function SettingsScreen() {
  const { t, language, setLanguage, languageOptions } = useI18n();
  const { signOut, deleteAccount, pending } = useAuth();
  const { isPremium, activatedAt, activatePremium, cancelPremium } = usePremium();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);

  function handleActivatePremium() {
    activatePremium();
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

      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("settings")}</Text>
        <Text style={styles.title}>{t("settingsTitle")}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("language")}</Text>
        <Text style={styles.sectionText}>{t("languageSubtitle")}</Text>
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

      <View style={isPremium ? styles.premiumCardActive : styles.premiumCard}>
        <View style={styles.premiumHeaderRow}>
          <Text style={isPremium ? styles.premiumSectionTitleActive : styles.premiumSectionTitle}>
            {t("premiumTitle")}
          </Text>
          {isPremium ? (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumBadgeText}>{t("premiumActive")}</Text>
            </View>
          ) : null}
        </View>
        <Text style={isPremium ? styles.premiumSubtitleActive : styles.premiumSubtitle}>
          {isPremium && activatedAt
            ? t("premiumActiveSince", { date: activatedAt.slice(0, 10) })
            : t("premiumSubtitle")}
        </Text>
        <View style={styles.premiumBenefits}>
          {(["premiumBenefit1", "premiumBenefit2", "premiumBenefit3"] as const).map((key) => (
            <View key={key} style={styles.premiumBenefitRow}>
              <Text style={styles.premiumBenefitDot}>✦</Text>
              <Text style={isPremium ? styles.premiumBenefitTextActive : styles.premiumBenefitText}>
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
    backgroundColor: "#261b14",
    borderRadius: 32,
    padding: 24,
    gap: 10,
  },
  eyebrow: {
    color: "#f5c99a",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
  },
  title: {
    color: "#fff8ef",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 36,
  },
  card: {
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 18,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#2f2318",
  },
  sectionText: {
    color: "#6b5647",
    lineHeight: 22,
  },
  languageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  languageChip: {
    borderRadius: 999,
    backgroundColor: "#fff1df",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  languageChipActive: {
    backgroundColor: "#261b14",
    borderColor: "#261b14",
  },
  languageChipText: {
    color: "#2a1d15",
    fontWeight: "700",
  },
  languageChipTextActive: {
    color: "#fff4e8",
  },
  signOutButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d9a0a0",
    backgroundColor: "#fff3f3",
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutButtonText: {
    color: "#8d2b2b",
    fontSize: 15,
    fontWeight: "800",
  },
  dangerZone: {
    borderRadius: 24,
    backgroundColor: "#fff5f5",
    borderWidth: 1,
    borderColor: "#e8b4b4",
    padding: 18,
    gap: 12,
  },
  dangerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#7a2020",
  },
  dangerText: {
    color: "#8d4444",
    lineHeight: 22,
  },
  deleteButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#922a2a",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    color: "#fff4e8",
    fontSize: 15,
    fontWeight: "800",
  },
  premiumCard: {
    borderRadius: 24,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
    padding: 18,
    gap: 12,
  },
  premiumCardActive: {
    borderRadius: 24,
    backgroundColor: "#2a1e17",
    borderWidth: 1,
    borderColor: "#d89c5b",
    padding: 18,
    gap: 12,
  },
  premiumHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  premiumSectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#2f2318",
  },
  premiumSectionTitleActive: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff8ef",
  },
  premiumBadge: {
    borderRadius: 999,
    backgroundColor: "#d89c5b",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  premiumBadgeText: {
    color: "#241912",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  premiumSubtitle: {
    color: "#6b5647",
    lineHeight: 22,
  },
  premiumSubtitleActive: {
    color: "#ead8c3",
    lineHeight: 22,
  },
  premiumBenefits: {
    gap: 8,
    marginTop: 4,
  },
  premiumBenefitRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  premiumBenefitDot: {
    color: "#d89c5b",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  premiumBenefitText: {
    flex: 1,
    color: "#2f2318",
    lineHeight: 22,
  },
  premiumBenefitTextActive: {
    flex: 1,
    color: "#fff7ef",
    lineHeight: 22,
  },
  premiumActivateButton: {
    borderRadius: 999,
    backgroundColor: "#d89c5b",
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  premiumActivateText: {
    color: "#241912",
    fontSize: 15,
    fontWeight: "800",
  },
  premiumCancelButton: {
    borderRadius: 999,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#e4c29a",
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  premiumCancelText: {
    color: "#fff7ef",
    fontSize: 14,
    fontWeight: "800",
  },
});
