import { useEffect, useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/screen";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { authClient } from "@/lib/supabase";

export default function AuthCallbackScreen() {
  const { session, ready } = useAuth();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !authClient) {
      return;
    }

    const client = authClient;
    let cancelled = false;

    async function finishAuth() {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      const query = url.searchParams;
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const authCode = query.get("code");
      const tokenHash = query.get("token_hash") ?? query.get("token");
      const authType = query.get("type") ?? hash.get("type");
      const errorCode = hash.get("error_code") ?? query.get("error_code");
      const errorDescription = hash.get("error_description") ?? query.get("error_description");

      try {
        if (errorCode || errorDescription) {
          throw new Error(errorDescription ?? errorCode ?? t("emailErrorGeneric"));
        }

        if (accessToken && refreshToken) {
          const { error: sessionError } = await client.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) {
            throw sessionError;
          }
        } else if (authCode) {
          const { error: exchangeError } = await client.exchangeCodeForSession(authCode);
          if (exchangeError) {
            throw exchangeError;
          }
        } else if (tokenHash && authType) {
          const normalizedType = authType === "magiclink" ? "email" : authType;
          const { error: verifyError } = await client.verifyOtp({
            token_hash: tokenHash,
            type: normalizedType as "email" | "signup" | "recovery" | "invite" | "email_change",
          });
          if (verifyError) {
            throw verifyError;
          }
        } else {
          throw new Error(t("authCallbackBadLink"));
        }

        if (!cancelled) {
          router.replace("/");
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : t("emailErrorGeneric"));
        }
      }
    }

    void finishAuth();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!ready || !session) {
      return;
    }
    router.replace("/");
  }, [ready, session]);

  return (
    <Screen scroll={false}>
      <View style={styles.wrap}>
        {error ? null : <ActivityIndicator size="large" color="#8a5a2b" />}
        <Text style={styles.title}>{error ? t("authCallbackBadLink") : t("authCallbackWorking")}</Text>
        <Text style={styles.subtitle}>{error ?? t("authCallbackBackSoon")}</Text>
        {error ? (
          <Pressable style={styles.retryButton} onPress={() => router.replace("/")}>
            <Text style={styles.retryButtonText}>{t("tryAgain")}</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  title: {
    color: "#2f2318",
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    color: "#6d5645",
    fontSize: 15,
    textAlign: "center",
    maxWidth: 420,
    lineHeight: 22,
  },
  retryButton: {
    marginTop: 8,
    borderRadius: 22,
    backgroundColor: "#261b14",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  retryButtonText: {
    color: "#fff5ea",
    fontSize: 15,
    fontWeight: "800",
  },
});
