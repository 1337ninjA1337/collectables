import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { AuthChangeEvent, Session, User } from "@supabase/auth-js";

import { trackEvent } from "@/lib/analytics";
import {
  FRESHLY_CREATED_WINDOW_MS,
  isFreshlyCreatedUser,
  shouldTrackSignupOnAuthEvent,
  signupEventProps,
} from "@/lib/auth-helpers";
import { deleteCloudinaryImages } from "@/lib/cloudinary";
import { setSentryUser } from "@/lib/sentry";
import { authClient, isSupabaseConfigured } from "@/lib/supabase";
import { clearAllUserData } from "@/lib/storage-keys";
import { deleteAccountViaEdgeFunction, fetchAllUserImageUrls } from "@/lib/supabase-profiles";
import { closeSharedRealtimeClient } from "@/lib/supabase-realtime";
import { getAppBaseUrl, resolveNumericEnv } from "@/lib/env";

WebBrowser.maybeCompleteAuthSession();

// Signup-freshness window for signup_completed detection. Env-tunable so QA
// can widen it (e.g. to 60 min) on staging runs where a slow verifyOtp
// round-trip delays the check past the 5-minute default. Resolved here — not
// in lib/auth-helpers.ts — because the helpers module must stay node-pure
// while the env read mirrors lib/social-context.tsx's
// EXPO_PUBLIC_PROFILE_CACHE_TTL_MS idiom (literal member access so
// Metro/babel inlines it in the web bundle).
const SIGNUP_FRESHNESS_WINDOW_MS = resolveNumericEnv(
  process.env.EXPO_PUBLIC_SIGNUP_FRESHNESS_WINDOW_MS,
  FRESHLY_CREATED_WINDOW_MS,
);

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
  // User ids whose signup_completed already fired this session — dedups the
  // verifyOtp resolution against the SIGNED_IN event for the same signup.
  const seenSignupUserIds = useRef<Set<string>>(new Set());

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
    } = authClient.onAuthStateChange((event: AuthChangeEvent, nextSession: Session | null) => {
      setSession(nextSession);
      // A freshly-created user's first SIGNED_IN is a signup — this is the
      // only signal the OAuth path (signInWithProvider) produces, since the
      // redirect flow never resolves through verifyOtp.
      const nextUser = nextSession?.user ?? null;
      if (
        nextUser?.id &&
        shouldTrackSignupOnAuthEvent(
          event,
          nextUser,
          seenSignupUserIds.current,
          Date.now(),
          SIGNUP_FRESHNESS_WINDOW_MS,
        )
      ) {
        seenSignupUserIds.current.add(nextUser.id);
        trackEvent("signup_completed", signupEventProps(nextUser));
      }
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
          const { data, error } = await authClient.verifyOtp({
            email: email.trim(),
            token: token.trim(),
            type: "email",
          });

          const freshUser = data?.user ?? null;
          if (
            !error &&
            isFreshlyCreatedUser(freshUser, Date.now(), SIGNUP_FRESHNESS_WINDOW_MS) &&
            freshUser?.id &&
            !seenSignupUserIds.current.has(freshUser.id)
          ) {
            seenSignupUserIds.current.add(freshUser.id);
            trackEvent("signup_completed", {
              method: "otp",
              provider: "email",
            });
          }

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
          await closeSharedRealtimeClient();
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
          await closeSharedRealtimeClient();
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
