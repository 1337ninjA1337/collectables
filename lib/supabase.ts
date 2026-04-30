import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthClient, SupportedStorage } from "@supabase/auth-js";
import { Platform } from "react-native";

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
