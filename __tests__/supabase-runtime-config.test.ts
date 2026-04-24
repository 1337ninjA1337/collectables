import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_KEY_KEY,
  RUNTIME_URL_KEY,
  canStoreRuntimeSupabaseConfig,
  clearRuntimeSupabaseConfig,
  readRuntimeSupabaseConfig,
  setRuntimeSupabaseConfig,
} from "@/lib/supabase-runtime-config";

type GlobalWithWindow = { window?: unknown };

function makeFakeStorage() {
  const store = new Map<string, string>();
  return {
    store,
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
}

function installFakeStorage() {
  const fake = makeFakeStorage();
  (globalThis as GlobalWithWindow).window = { localStorage: fake.storage };
  return fake;
}

function setRawWindow(win: unknown) {
  (globalThis as GlobalWithWindow).window = win;
}

function uninstallFakeStorage() {
  delete (globalThis as GlobalWithWindow).window;
}

describe("supabase runtime config", () => {
  afterEach(() => {
    uninstallFakeStorage();
  });

  describe("with no browser storage available", () => {
    beforeEach(() => {
      uninstallFakeStorage();
    });

    it("reports that runtime config cannot be stored", () => {
      assert.equal(canStoreRuntimeSupabaseConfig(), false);
    });

    it("returns an empty config object on read", () => {
      assert.deepEqual(readRuntimeSupabaseConfig(), {});
    });

    it("returns false when attempting to set runtime config", () => {
      assert.equal(setRuntimeSupabaseConfig("https://x.supabase.co", "key"), false);
    });

    it("returns false when attempting to clear runtime config", () => {
      assert.equal(clearRuntimeSupabaseConfig(), false);
    });
  });

  describe("with browser storage available", () => {
    it("reports that runtime config can be stored", () => {
      installFakeStorage();
      assert.equal(canStoreRuntimeSupabaseConfig(), true);
    });

    it("persists trimmed url and key into localStorage under stable keys", () => {
      const fake = installFakeStorage();
      const ok = setRuntimeSupabaseConfig(
        "  https://demo.supabase.co  ",
        "  publishable-anon-key  ",
      );
      assert.equal(ok, true);
      assert.equal(fake.store.get(RUNTIME_URL_KEY), "https://demo.supabase.co");
      assert.equal(fake.store.get(RUNTIME_KEY_KEY), "publishable-anon-key");
    });

    it("returns the persisted url/key on read", () => {
      installFakeStorage();
      setRuntimeSupabaseConfig("https://demo.supabase.co", "publishable-anon-key");

      assert.deepEqual(readRuntimeSupabaseConfig(), {
        url: "https://demo.supabase.co",
        key: "publishable-anon-key",
      });
    });

    it("refuses to persist empty / whitespace-only inputs", () => {
      const fake = installFakeStorage();
      assert.equal(setRuntimeSupabaseConfig("", "key"), false);
      assert.equal(setRuntimeSupabaseConfig("   ", "key"), false);
      assert.equal(setRuntimeSupabaseConfig("https://x", ""), false);
      assert.equal(setRuntimeSupabaseConfig("https://x", "   "), false);
      assert.equal(fake.store.size, 0);
    });

    it("returns undefined fields when nothing is stored yet", () => {
      installFakeStorage();
      assert.deepEqual(readRuntimeSupabaseConfig(), { url: undefined, key: undefined });
    });

    it("clears persisted runtime config", () => {
      const fake = installFakeStorage();
      setRuntimeSupabaseConfig("https://demo.supabase.co", "publishable-anon-key");
      assert.equal(fake.store.size, 2);

      const ok = clearRuntimeSupabaseConfig();
      assert.equal(ok, true);
      assert.equal(fake.store.size, 0);
    });

    it("swallows storage exceptions on read", () => {
      setRawWindow({
        localStorage: {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => {},
          removeItem: () => {},
        },
      });

      assert.deepEqual(readRuntimeSupabaseConfig(), {});
    });

    it("swallows storage exceptions on write", () => {
      setRawWindow({
        localStorage: {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota");
          },
          removeItem: () => {},
        },
      });

      assert.equal(setRuntimeSupabaseConfig("https://x.supabase.co", "key"), false);
    });
  });
});
