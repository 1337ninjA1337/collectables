import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { AuthChangeEvent, Session, User } from "@supabase/auth-js";

import { authClient, isSupabaseConfigured } from "@/lib/supabase";

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  user: User | null;
  pending: boolean;
  sendEmailOtp: (email: string) => Promise<{ error?: string }>;
  verifyEmailOtp: (email: string, token: string) => Promise<{ error?: string }>;
  signInWithProvider: (provider: "google" | "apple") => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const redirectUri = makeRedirectUri({
  scheme: "collectables",
  path: "auth/callback",
});

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!authClient) {
      setReady(true);
      return;
    }

    let active = true;

    authClient
      .getSession()
      .then(({ data }: { data: { session: Session | null } }) => {
        if (active) {
          setSession(data.session);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setReady(true);
        }
      });

    const {
      data: { subscription },
    } = authClient.onAuthStateChange((_event: AuthChangeEvent, nextSession: Session | null) => {
      setSession(nextSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      ready,
      configured: isSupabaseConfigured,
      session,
      user: session?.user ?? null,
      pending,
      sendEmailOtp: async (email) => {
        if (!authClient) {
          return { error: "Supabase не настроен. Добавьте EXPO_PUBLIC_SUPABASE_URL и EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY." };
        }

        setPending(true);
        try {
          const { error } = await authClient.signInWithOtp({
            email: email.trim(),
            options: { shouldCreateUser: true },
          });

          return error ? { error: error.message } : {};
        } finally {
          setPending(false);
        }
      },
      verifyEmailOtp: async (email, token) => {
        if (!authClient) {
          return { error: "Supabase не настроен. Добавьте EXPO_PUBLIC_SUPABASE_URL и EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY." };
        }

        setPending(true);
        try {
          const { error } = await authClient.verifyOtp({
            email: email.trim(),
            token: token.trim(),
            type: "email",
          });

          return error ? { error: error.message } : {};
        } finally {
          setPending(false);
        }
      },
      signInWithProvider: async (provider) => {
        if (!authClient) {
          return { error: "Supabase не настроен. Добавьте EXPO_PUBLIC_SUPABASE_URL и EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY." };
        }

        setPending(true);
        try {
          const isWeb = Platform.OS === "web";
          const { data, error } = await authClient.signInWithOAuth({
            provider,
            options: {
              redirectTo: redirectUri,
              skipBrowserRedirect: !isWeb,
            },
          });

          if (error) {
            return { error: error.message };
          }

          if (!isWeb && data?.url) {
            const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
            if (result.type === "success" && result.url) {
              const url = new URL(result.url);
              const code = url.searchParams.get("code");

              if (code) {
                const { error: exchangeError } = await authClient.exchangeCodeForSession(code);
                if (exchangeError) {
                  return { error: exchangeError.message };
                }
              }
            }
          }

          return {};
        } finally {
          setPending(false);
        }
      },
      signOut: async () => {
        if (!authClient) {
          return;
        }

        setPending(true);
        try {
          await authClient.signOut();
        } finally {
          setPending(false);
        }
      },
    };
  }, [pending, ready, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
