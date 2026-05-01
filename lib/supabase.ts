import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthClient, SupportedStorage } from "@supabase/auth-js";
import { Platform } from "react-native";

const RUNTIME_CONFIG_KEY = "collectables-supabase-runtime-config";

function readLocalStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function parseRuntimeConfig(): { url: string; key: string } | null {
  const raw = readLocalStorage(RUNTIME_CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).url === "string" &&
      typeof (parsed as Record<string, unknown>).key === "string"
    ) {
      return {
        url: (parsed as { url: string }).url,
        key: (parsed as { key: string }).key,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export function setRuntimeSupabaseConfig(url: string, key: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage?.setItem(RUNTIME_CONFIG_KEY, JSON.stringify({ url, key }));
    } catch {
      // ignore
    }
  }
}

export function clearRuntimeSupabaseConfig(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage?.removeItem(RUNTIME_CONFIG_KEY);
    } catch {
      // ignore
    }
  }
}

const runtimeConfig = parseRuntimeConfig();
export const isRuntimeConfigured = runtimeConfig !== null;

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || runtimeConfig?.url;
export const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || runtimeConfig?.key;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

const memoryStorage = new Map<string, string>();

const webStorage: SupportedStorage = {
  getItem: async (key) => {
    if (typeof window === "undefined") {
      return memoryStorage.get(key) ?? null;
    }

    return window.localStorage.getItem(key);
  },
  setItem: async (key, value) => {
    if (typeof window === "undefined") {
      memoryStorage.set(key, value);
      return;
    }

    window.localStorage.setItem(key, value);
  },
  removeItem: async (key) => {
    if (typeof window === "undefined") {
      memoryStorage.delete(key);
      return;
    }

    window.localStorage.removeItem(key);
  },
};

const storage = Platform.OS === "web" ? webStorage : AsyncStorage;

export const authClient = isSupabaseConfigured
  ? new AuthClient({
      url: `${supabaseUrl!}/auth/v1`,
      headers: {
        apikey: supabasePublishableKey!,
      },
      storageKey: "collectables-auth",
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    })
  : null;
