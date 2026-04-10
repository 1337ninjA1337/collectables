import { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Screen } from "@/components/screen";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";

export function LoginScreen() {
  const { configured, pending, sendEmailOtp, verifyEmailOtp, signInWithProvider } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function handleSendCode() {
    setEmailError(null);

    if (!email.trim()) {
      Alert.alert(t("needEmailTitle"), t("needEmailText"));
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
      Alert.alert(t("loginFailed"), result.error);
    }
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t("authAccount")}</Text>
        <Text style={styles.title}>{t("authTitle")}</Text>
        <Text style={styles.subtitle}>{t("authSubtitle")}</Text>
      </View>

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
            <Pressable style={{...styles.primaryButton, ...(pending ? styles.disabledButton : {})}} onPress={handleVerifyCode} disabled={pending}>
              <Text style={styles.primaryButtonText}>{t("confirmCode")}</Text>
            </Pressable>
            <Pressable style={{...styles.secondaryButton, ...(pending ? styles.disabledButton : {})}} onPress={handleSendCode} disabled={pending}>
              <Text style={styles.secondaryButtonText}>{t("resendCode")}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={{...styles.primaryButton, ...(pending ? styles.disabledButton : {})}} onPress={handleSendCode} disabled={pending}>
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

      {!configured ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>{t("configureSupabase")}</Text>
          <Text style={styles.warningText}>{t("configureSupabaseText")}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: "#261b14",
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
  },
  title: {
    color: "#fff8ef",
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "800",
  },
  subtitle: {
    color: "#ead8c3",
    fontSize: 15,
    lineHeight: 23,
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
  },
  sectionText: {
    color: "#6f5c4d",
    lineHeight: 22,
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
  },
  disabledButton: {
    opacity: 0.65,
  },
  errorText: {
    color: "#a13434",
    lineHeight: 22,
    fontSize: 14,
    fontWeight: "600",
  },
  providerHint: {
    color: "#856d5a",
    lineHeight: 21,
  },
  warningCard: {
    borderRadius: 28,
    padding: 20,
    gap: 8,
    backgroundColor: "#fff1e6",
    borderWidth: 1,
    borderColor: "#f0c8a1",
  },
  warningTitle: {
    color: "#8a5220",
    fontSize: 18,
    fontWeight: "800",
  },
  warningText: {
    color: "#8a5d36",
    lineHeight: 22,
  },
});
