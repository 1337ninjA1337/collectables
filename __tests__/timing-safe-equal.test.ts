import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  encodeUtf8,
  timingSafeEqualStrings,
} from "../supabase/functions/_shared/timing-safe-equal";

/**
 * Shared constant-time secret comparison
 * (`supabase/functions/_shared/timing-safe-equal.ts`).
 *
 * The helper is pure apart from `node:crypto` (which resolves in both Node
 * and the Deno Edge runtime via the `node:` specifier), so the REAL module is
 * executed here. The Deno function that adopts it (`analytics-mirror`) gets a
 * structural adoption guard at the bottom, mirroring the `_shared/cors.ts` /
 * `assert-caller.ts` test split.
 */

describe("encodeUtf8", () => {
  it("encodes ASCII to one byte per character", () => {
    assert.deepEqual(Array.from(encodeUtf8("abc")), [0x61, 0x62, 0x63]);
  });

  it("encodes multi-byte characters to their UTF-8 bytes (not UTF-16 units)", () => {
    // U+00E9 é is a single UTF-16 code unit but two UTF-8 bytes.
    assert.deepEqual(Array.from(encodeUtf8("é")), [0xc3, 0xa9]);
  });

  it("encodes the empty string to zero bytes", () => {
    assert.equal(encodeUtf8("").byteLength, 0);
  });
});

describe("timingSafeEqualStrings", () => {
  it("returns true for identical secrets", () => {
    assert.equal(timingSafeEqualStrings("hunter2", "hunter2"), true);
  });

  it("returns true for identical multi-byte secrets", () => {
    assert.equal(timingSafeEqualStrings("sécrét-🔑", "sécrét-🔑"), true);
  });

  it("returns false for same-length secrets that differ", () => {
    assert.equal(timingSafeEqualStrings("hunter2", "hunter3"), false);
  });

  it("returns false for different-length secrets", () => {
    assert.equal(timingSafeEqualStrings("short", "a-much-longer-secret"), false);
  });

  it("does not throw when UTF-16 lengths match but UTF-8 byte lengths differ", () => {
    // "aé" and "ab" are both 2 UTF-16 code units, but 3 vs 2 UTF-8 bytes —
    // the crypto primitive throws on unequal buffer lengths, so the guard
    // must short-circuit to false instead.
    assert.equal("aé".length, "ab".length);
    assert.equal(timingSafeEqualStrings("aé", "ab"), false);
  });

  it("treats two empty strings as equal", () => {
    assert.equal(timingSafeEqualStrings("", ""), true);
  });

  it("returns false when only one side is empty", () => {
    assert.equal(timingSafeEqualStrings("", "x"), false);
    assert.equal(timingSafeEqualStrings("x", ""), false);
  });
});

describe("timing-safe-equal — structural", () => {
  const HELPER_SOURCE = readFileSync(
    path.join(
      process.cwd(),
      "supabase",
      "functions",
      "_shared",
      "timing-safe-equal.ts",
    ),
    "utf8",
  );

  it("delegates to the crypto primitive instead of a hand-rolled loop", () => {
    assert.match(HELPER_SOURCE, /from\s+['"]node:crypto['"]/);
    assert.match(HELPER_SOURCE, /timingSafeEqual\(left, right\)/);
    // The doc comment may reference the old loop by name; only an actual
    // `.charCodeAt(` call is a regression.
    assert.doesNotMatch(HELPER_SOURCE, /\.charCodeAt\(/);
  });

  it("is adopted by analytics-mirror (no local re-roll left behind)", () => {
    const fnSource = readFileSync(
      path.join(
        process.cwd(),
        "supabase",
        "functions",
        "analytics-mirror",
        "index.ts",
      ),
      "utf8",
    );
    assert.match(
      fnSource,
      /from\s+['"]\.\.\/_shared\/timing-safe-equal\.ts['"]/,
    );
    assert.match(fnSource, /timingSafeEqualStrings\(/);
    assert.doesNotMatch(fnSource, /function timingSafeEqual\b/);
    assert.doesNotMatch(fnSource, /charCodeAt/);
  });
});
