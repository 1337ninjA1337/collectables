import AsyncStorage from "@react-native-async-storage/async-storage";

export const LANGUAGE_KEY = "collectables-language-v1";
export const SOCIAL_GRAPH_KEY = "collectables-social-graph-v1";
export const MARKETPLACE_KEY = "collectables-marketplace-v1";

export function collectionsKey(userId: string): string {
  return `collectables-collections-v1-${userId}`;
}

export function itemsKey(userId: string): string {
  return `collectables-items-v1-${userId}`;
}

export function followedCollectionsKey(userId: string): string {
  return `collectables-followed-collections-v1-${userId}`;
}

export function chatCacheKey(userId: string): string {
  return `collectables-chats-v1-${userId}`;
}

export function socialCacheKey(userId: string): string {
  return `collectables-social-v1-${userId}`;
}

export function premiumKey(userId: string): string {
  return `collectables-premium-v1-${userId}`;
}

export async function migrateStorageKey(oldKey: string, newKey: string): Promise<void> {
  try {
    const value = await AsyncStorage.getItem(oldKey);
    if (value === null) return;
    await AsyncStorage.setItem(newKey, value);
    await AsyncStorage.removeItem(oldKey);
  } catch {
    // Best-effort: migration failure must not crash context boot.
  }
}

export async function clearAllUserData(userId: string): Promise<void> {
  const keys = [
    collectionsKey(userId),
    itemsKey(userId),
    followedCollectionsKey(userId),
    chatCacheKey(userId),
    socialCacheKey(userId),
    premiumKey(userId),
    SOCIAL_GRAPH_KEY,
    LANGUAGE_KEY,
    MARKETPLACE_KEY,
  ];
  await AsyncStorage.multiRemove(keys);
}
