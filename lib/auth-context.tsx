import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { AuthChangeEvent, Session, User } from "@supabase/auth-js";

import { deleteCloudinaryImages } from "@/lib/cloudinary";
import { setSentryUser } from "@/lib/sentry";
import { authClient, isSupabaseConfigured } from "@/lib/supabase";
import { clearAllUserData } from "@/lib/storage-keys";
import { deleteAccountViaEdgeFunction, fetchAllUserImageUrls } from "@/lib/supabase-profiles";
import { getAppBaseUrl } from "@/lib/env";

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
  deleteAccount: () => Promise<{ error?: string }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const redirectUri =
  Platform.OS === "web"
    ? `${getAppBaseUrl()}/auth/callback`
    : makeRedirectUri({ scheme: "collectables", path: "auth/callback" });

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

  useEffect(() => {
    if (session?.user) {
      setSentryUser({ id: session.user.id, email: session.user.email });
    } else {
      setSentryUser(null);
    }
  }, [session?.user?.id, session?.user?.email]);

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
            options: { shouldCreateUser: true, emailRedirectTo: redirectUri },
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
      deleteAccount: async () => {
        if (!authClient || !session?.user) {
          return { error: "Not signed in" };
        }

        const userId = session.user.id;

        setPending(true);
        try {
          const imageUrls = await fetchAllUserImageUrls(userId);
          await deleteCloudinaryImages(imageUrls);

          const { error } = await deleteAccountViaEdgeFunction();
          if (error) {
            return { error };
          }

          await clearAllUserData(userId);

          await authClient.signOut();
          return {};
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
