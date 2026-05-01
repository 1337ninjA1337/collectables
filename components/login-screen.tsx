import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Screen } from "@/components/screen";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import {
  clearRuntimeSupabaseConfig,
  isRuntimeConfigured,
  setRuntimeSupabaseConfig,
} from "@/lib/supabase";
import { useToast } from "@/lib/toast-context";

export function LoginScreen() {
  const { configured, pending, sendEmailOtp, verifyEmailOtp, signInWithProvider } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [runtimeUrl, setRuntimeUrl] = useState("");
  const [runtimeKey, setRuntimeKey] = useState("");

  function handleSaveRuntimeConfig() {
    const url = runtimeUrl.trim();
    const key = runtimeKey.trim();
    if (!url || !key) return;
    setRuntimeSupabaseConfig(url, key);
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  function handleClearRuntimeConfig() {
    clearRuntimeSupabaseConfig();
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  async function handleSendCode() {
    setEmailError(null);

    if (!email.trim()) {
      toast.error(t("needEmailText"), t("needEmailTitle"));
      return;
    }

    const result = await sendEmailOtp(email);
    if (result.error) {
      if (result.error.includes("429") || result.error.toLowerCase().includes("rate limit")) {
        setEmailError(t("emailErrorRateLimit"));
      } else {
        setEmailError(t("emailErrorGeneric"));
      }
      return;
    }

    setAwaitingCode(true);
    setEmailError(null);
  }

  async function handleVerifyCode() {
    setEmailError(null);

    if (!email.trim() || !code.trim()) {
      setEmailError(t("emailCodeRequired"));
      return;
    }

    const result = await verifyEmailOtp(email, code);
    if (result.error) {
      setEmailError(t("emailErrorVerify"));
    }
  }

  async function handleProviderLogin(provider: "google" | "apple") {
    const result = await signInWithProvider(provider);
    if (result.error) {
      toast.error(result.error, t("loginFailed"));
    }
  }

  return (
    <Screen>
      <LinearGradient
        colors={["#3d2810", "#261b14", "#1e140e"]}
        start={{ x: 0.2, y: 0.6 }}
        end={{ x: 1, y: 0 }}
        style={styles.hero}
      >
        <Text style={styles.eyebrow}>{t("authAccount")}</Text>
        <Text style={styles.title}>{t("authTitle")}</Text>
        <Text style={styles.subtitle}>{t("authSubtitle")}</Text>
      </LinearGradient>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("emailLoginTitle")}</Text>
        <Text style={styles.sectionText}>{t("emailLoginSubtitle")}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t("emailPlaceholder")}
          placeholderTextColor="#9b8571"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
        {awaitingCode ? (
          <>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder={t("codePlaceholder")}
              placeholderTextColor="#9b8571"
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
            />
            <Pressable style={{...styles.primaryButton, ...(pending || !configured ? styles.disabledButton : {})}} onPress={handleVerifyCode} disabled={pending || !configured}>
              <Text style={styles.primaryButtonText}>{t("confirmCode")}</Text>
            </Pressable>
            <Pressable style={{...styles.secondaryButton, ...(pending || !configured ? styles.disabledButton : {})}} onPress={handleSendCode} disabled={pending || !configured}>
              <Text style={styles.secondaryButtonText}>{t("resendCode")}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={{...styles.primaryButton, ...(pending || !configured ? styles.disabledButton : {})}} onPress={handleSendCode} disabled={pending || !configured}>
            <Text style={styles.primaryButtonText}>{t("getCode")}</Text>
          </Pressable>
        )}
        {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("quickLoginTitle")}</Text>
        <Text style={styles.sectionText}>{t("quickLoginSubtitle")}</Text>
        <Pressable style={{...styles.secondaryButton, ...(pending ? styles.disabledButton : {})}} onPress={() => handleProviderLogin("google")} disabled={pending || !configured}>
          <Text style={styles.secondaryButtonText}>{t("continueGoogle")}</Text>
        </Pressable>
        <Pressable style={{...styles.secondaryButton, ...(pending ? styles.disabledButton : {})}} onPress={() => handleProviderLogin("apple")} disabled={pending || !configured}>
          <Text style={styles.secondaryButtonText}>{t("continueApple")}</Text>
        </Pressable>
        <Text style={styles.providerHint}>{Platform.OS === "web" ? t("providerHintWeb") : t("providerHintMobile")}</Text>
      </View>

      {Platform.OS === "web" && !configured && (
        <View style={styles.runtimeCard}>
          <Text style={styles.sectionTitle}>{t("runtimeConfigTitle")}</Text>
          <Text style={styles.sectionText}>{t("runtimeConfigSubtitle")}</Text>
          <Text style={styles.inputLabel}>{t("runtimeConfigUrlLabel")}</Text>
          <TextInput
            value={runtimeUrl}
            onChangeText={setRuntimeUrl}
            placeholder={t("runtimeConfigUrlPlaceholder")}
            placeholderTextColor="#9b8571"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Text style={styles.inputLabel}>{t("runtimeConfigKeyLabel")}</Text>
          <TextInput
            value={runtimeKey}
            onChangeText={setRuntimeKey}
            placeholder={t("runtimeConfigKeyPlaceholder")}
            placeholderTextColor="#9b8571"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable
            style={{...styles.primaryButton, ...(!runtimeUrl.trim() || !runtimeKey.trim() ? styles.disabledButton : {})}}
            onPress={handleSaveRuntimeConfig}
            disabled={!runtimeUrl.trim() || !runtimeKey.trim()}
          >
            <Text style={styles.primaryButtonText}>{t("runtimeConfigSave")}</Text>
          </Pressable>
        </View>
      )}

      {Platform.OS === "web" && isRuntimeConfigured && (
        <View style={styles.runtimeBadgeRow}>
          <View style={styles.runtimeBadge}>
            <Text style={styles.runtimeBadgeText}>{t("runtimeConfiguredBadge")}</Text>
          </View>
          <Pressable style={styles.clearRuntimeButton} onPress={handleClearRuntimeConfig}>
            <Text style={styles.clearRuntimeText}>{t("runtimeConfigClear")}</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 32,
    padding: 24,
    gap: 12,
  },
  eyebrow: {
    color: "#f5c99a",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
    fontFamily: "DMSans-ExtraBold",
  },
  title: {
    color: "#fff8ef",
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "800",
    fontFamily: "Syne-ExtraBold",
  },
  subtitle: {
    color: "#ead8c3",
    fontSize: 15,
    lineHeight: 23,
    fontFamily: "DMSans-Regular",
  },
  card: {
    borderRadius: 28,
    padding: 20,
    gap: 12,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#eadbc8",
  },
  sectionTitle: {
    color: "#2f2318",
    fontSize: 22,
    fontWeight: "800",
    fontFamily: "Syne-ExtraBold",
  },
  sectionText: {
    color: "#6f5c4d",
    lineHeight: 22,
    fontFamily: "DMSans-Regular",
  },
  input: {
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eadbc8",
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#2f2318",
    fontSize: 16,
    fontFamily: 'DMSans-Regular',
  },
  primaryButton: {
    borderRadius: 22,
    backgroundColor: "#d89c5b",
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#241912",
    fontWeight: "800",
    fontSize: 15,
    fontFamily: "DMSans-ExtraBold",
  },
  secondaryButton: {
    borderRadius: 22,
    backgroundColor: "#2c2017",
    paddingVertical: 16,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#fff4e8",
    fontWeight: "800",
    fontSize: 15,
    fontFamily: "DMSans-ExtraBold",
  },
  disabledButton: {
    opacity: 0.65,
  },
  errorText: {
    color: "#a13434",
    lineHeight: 22,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: 'DMSans-SemiBold',
  },
  providerHint: {
    color: "#856d5a",
    lineHeight: 21,
    fontFamily: 'DMSans-Regular',
  },
  runtimeCard: {
    borderRadius: 28,
    padding: 20,
    gap: 12,
    backgroundColor: "#fffaf3",
    borderWidth: 1,
    borderColor: "#c8b99a",
  },
  inputLabel: {
    color: "#5a4030",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: -4,
  },
  runtimeBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  runtimeBadge: {
    borderRadius: 999,
    backgroundColor: "#f0e6d3",
    borderWidth: 1,
    borderColor: "#c8a87a",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  runtimeBadgeText: {
    color: "#5a3b1a",
    fontSize: 12,
    fontWeight: "700",
  },
  clearRuntimeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d9a0a0",
    backgroundColor: "#fff3f3",
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  clearRuntimeText: {
    color: "#8d2b2b",
    fontSize: 12,
    fontWeight: "700",
  },
});
