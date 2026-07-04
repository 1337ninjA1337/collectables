import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { MaskedTextInput } from "@/components/masked-text-input";

import { Screen } from "@/components/screen";
import { useAuth } from "@/lib/auth-context";
import {
  AMBER_ACCENT,
  AMBER_LIGHT,
  BORDER,
  CARD_BG,
  DANGER_DEEP,
  HERO_DARK,
  HERO_DARK_4,
  HERO_DARK_5,
  HERO_DARK_6,
  MUTED_6,
  MUTED_7,
  PLACEHOLDER,
  PURE_WHITE,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useToast } from "@/lib/toast-context";
import { FONT_DISPLAY, FONT_BODY, FONT_BODY_SEMIBOLD, FONT_BODY_EXTRABOLD } from "@/lib/fonts";

export function LoginScreen() {
  const { pending, sendEmailOtp, verifyEmailOtp, signInWithProvider } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
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
        colors={[HERO_DARK_4, HERO_DARK, HERO_DARK_5]}
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
        <MaskedTextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t("emailPlaceholder")}
          placeholderTextColor={PLACEHOLDER}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
        {awaitingCode ? (
          <>
            <MaskedTextInput
              value={code}
              onChangeText={setCode}
              placeholder={t("codePlaceholder")}
              placeholderTextColor={PLACEHOLDER}
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
        <Pressable style={{...styles.secondaryButton, ...(pending ? styles.disabledButton : {})}} onPress={() => handleProviderLogin("google")} disabled={pending}>
          <Text style={styles.secondaryButtonText}>{t("continueGoogle")}</Text>
        </Pressable>
        <Pressable style={{...styles.secondaryButton, ...(pending ? styles.disabledButton : {})}} onPress={() => handleProviderLogin("apple")} disabled={pending}>
          <Text style={styles.secondaryButtonText}>{t("continueApple")}</Text>
        </Pressable>
        <Text style={styles.providerHint}>{Platform.OS === "web" ? t("providerHintWeb") : t("providerHintMobile")}</Text>
      </View>

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
    color: AMBER_LIGHT,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  title: {
    color: TEXT_ON_DARK_3,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY,
  },
  subtitle: {
    color: TEXT_ON_DARK_SOFT,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: FONT_BODY,
  },
  card: {
    borderRadius: 28,
    padding: 20,
    gap: 12,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sectionTitle: {
    color: TEXT_DARK,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY,
  },
  sectionText: {
    color: MUTED_6,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
  input: {
    borderRadius: 22,
    backgroundColor: PURE_WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: TEXT_DARK,
    fontSize: 16,
    fontFamily: FONT_BODY,
  },
  primaryButton: {
    borderRadius: 22,
    backgroundColor: AMBER_ACCENT,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryButtonText: {
    color: TEXT_DARK_2,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  secondaryButton: {
    borderRadius: 22,
    backgroundColor: HERO_DARK_6,
    paddingVertical: 16,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
    fontSize: 15,
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  disabledButton: {
    opacity: 0.65,
  },
  errorText: {
    color: DANGER_DEEP,
    lineHeight: 22,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: FONT_BODY_SEMIBOLD,
  },
  providerHint: {
    color: MUTED_7,
    lineHeight: 21,
    fontFamily: FONT_BODY,
  },
});
