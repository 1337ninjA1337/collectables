/**
 * Node-loadable stand-in for `@react-native-async-storage/async-storage`.
 *
 * The real package resolves to a react-native module that esbuild cannot
 * transform, and it is pulled in transitively by every context provider
 * (`lib/i18n-context.tsx` → `LANGUAGE_KEY` read on mount), so a render test
 * that never touches storage still needs it to load.
 *
 * Backed by a real in-memory `Map` rather than no-op stubs so a test can seed
 * a value with `__seedAsyncStorage` and let the provider's mount effect read
 * it back. `__resetAsyncStorage` clears it — module scope survives between
 * test files in the same process, so a suite that seeds must also reset.
 */

const store = new Map();

const AsyncStorage = {
  getItem: async (key) => (store.has(key) ? store.get(key) : null),
  setItem: async (key, value) => {
    store.set(key, String(value));
  },
  removeItem: async (key) => {
    store.delete(key);
  },
  multiGet: async (keys) => keys.map((key) => [key, store.has(key) ? store.get(key) : null]),
  multiSet: async (pairs) => {
    for (const [key, value] of pairs) store.set(key, String(value));
  },
  multiRemove: async (keys) => {
    for (const key of keys) store.delete(key);
  },
  getAllKeys: async () => [...store.keys()],
  clear: async () => {
    store.clear();
  },
};

export function __seedAsyncStorage(key, value) {
  store.set(key, String(value));
}

export function __resetAsyncStorage() {
  store.clear();
}

export default AsyncStorage;
