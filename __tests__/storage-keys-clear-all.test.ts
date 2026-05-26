import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { COLLECTABLES_STORAGE_PREFIX } from "../lib/storage-keys";

/**
 * `clearAllCollectablesStorage` and `getAllCollectablesKeys` depend on the
 * native `@react-native-async-storage/async-storage` module which can't load
 * under plain `node:test`. We pin the behaviour via a structural source-scan
 * (same shape as `__tests__/dev-menu-wiring.test.ts`) and verify the only
 * pure constant the module exports.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("collectables storage prefix", () => {
  it("exports the canonical 'collectables-' prefix", () => {
    assert.equal(COLLECTABLES_STORAGE_PREFIX, "collectables-");
  });

  it("every per-user and global storage key starts with the prefix", () => {
    const src = read("lib/storage-keys.ts");
    // Pin every `... = "collectables-...-v1..."` literal to the canonical prefix
    // so a future contributor can't introduce a stray key the dev reset misses.
    const literals = src.match(/"collectables-[^"]+"/g) ?? [];
    assert.ok(literals.length > 0, "expected at least one collectables-* literal");
    for (const literal of literals) {
      assert.ok(
        literal.startsWith(`"${COLLECTABLES_STORAGE_PREFIX}`),
        `literal ${literal} must start with the canonical prefix`,
      );
    }
  });
});

describe("clearAllCollectablesStorage + getAllCollectablesKeys (structural)", () => {
  const src = read("lib/storage-keys.ts");

  it("exports getAllCollectablesKeys backed by AsyncStorage.getAllKeys()", () => {
    assert.match(
      src,
      /export\s+async\s+function\s+getAllCollectablesKeys\s*\(\s*\)\s*:\s*Promise<string\[\]>/,
      "must export an async getAllCollectablesKeys(): Promise<string[]>",
    );
    assert.match(
      src,
      /AsyncStorage\.getAllKeys\s*\(\s*\)/,
      "must read keys via AsyncStorage.getAllKeys()",
    );
    assert.match(
      src,
      /\.filter\s*\(\s*\(\s*\w+\s*\)\s*=>\s*\w+\.startsWith\s*\(\s*COLLECTABLES_STORAGE_PREFIX\s*\)\s*\)/,
      "must filter keys via .startsWith(COLLECTABLES_STORAGE_PREFIX)",
    );
  });

  it("exports clearAllCollectablesStorage that uses multiRemove and short-circuits on empty", () => {
    assert.match(
      src,
      /export\s+async\s+function\s+clearAllCollectablesStorage\s*\(\s*\)\s*:\s*Promise<void>/,
      "must export an async clearAllCollectablesStorage(): Promise<void>",
    );
    assert.match(
      src,
      /AsyncStorage\.multiRemove\s*\(/,
      "must batch the deletion via AsyncStorage.multiRemove()",
    );
    assert.match(
      src,
      /if\s*\(\s*keys\.length\s*===\s*0\s*\)\s*return/,
      "must short-circuit when no collectables-* keys exist",
    );
  });

  it("calls getAllCollectablesKeys() to drive the multiRemove batch", () => {
    // Pin the composition so a future refactor can't accidentally inline a
    // second `.getAllKeys()` filter and miss the prefix-broadening rule.
    assert.match(
      src,
      /clearAllCollectablesStorage[\s\S]*?getAllCollectablesKeys\s*\(\s*\)/,
      "clearAllCollectablesStorage must delegate enumeration to getAllCollectablesKeys",
    );
  });
});
