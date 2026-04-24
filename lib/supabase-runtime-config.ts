/**
 * Tiny dependency-free helpers for reading/writing runtime Supabase credentials
 * to the browser's localStorage. The deployed GitHub Pages bundle is built
 * without `EXPO_PUBLIC_SUPABASE_*` env vars, so this lets users paste their
 * own credentials at runtime without a rebuild.
 *
 * Web-only: returns no-op / undefined on platforms without window.localStorage.
 *
 * Kept in its own file (no React Native imports) so it can be unit tested in
 * pure Node without pulling in the Expo runtime.
 */

export const RUNTIME_URL_KEY = "collectables-supabase-url";
export const RUNTIME_KEY_KEY = "collectables-supabase-publishable-key";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function getStorage(): StorageLike | null {
  if (typeof globalThis === "undefined") return null;

  const win = (globalThis as { window?: { localStorage?: StorageLike } }).window;
  const storage = win?.localStorage;
  if (!storage) return null;

  return storage;
}

export function readRuntimeSupabaseConfig(): { url?: string; key?: string } {
  const storage = getStorage();
  if (!storage) return {};

  try {
    const url = storage.getItem(RUNTIME_URL_KEY) || undefined;
    const key = storage.getItem(RUNTIME_KEY_KEY) || undefined;
    return { url, key };
  } catch {
    return {};
  }
}

export function setRuntimeSupabaseConfig(url: string, key: string): boolean {
  const storage = getStorage();
  if (!storage) return false;

  const trimmedUrl = url.trim();
  const trimmedKey = key.trim();
  if (!trimmedUrl || !trimmedKey) return false;

  try {
    storage.setItem(RUNTIME_URL_KEY, trimmedUrl);
    storage.setItem(RUNTIME_KEY_KEY, trimmedKey);
    return true;
  } catch {
    return false;
  }
}

export function clearRuntimeSupabaseConfig(): boolean {
  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.removeItem(RUNTIME_URL_KEY);
    storage.removeItem(RUNTIME_KEY_KEY);
    return true;
  } catch {
    return false;
  }
}

export function canStoreRuntimeSupabaseConfig(): boolean {
  return getStorage() !== null;
}
