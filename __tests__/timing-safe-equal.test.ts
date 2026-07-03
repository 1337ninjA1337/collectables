import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { timingSafeEqual } from "../lib/timing-safe-equal";

describe("timingSafeEqual", () => {
  it("returns true for identical ASCII strings", () => {
    assert.equal(timingSafeEqual("whsec_abc123", "whsec_abc123"), true);
  });

  it("returns false for same-length ASCII strings that differ", () => {
    assert.equal(timingSafeEqual("whsec_abc123", "whsec_abc124"), false);
  });

  it("returns false when only the first byte differs", () => {
    assert.equal(timingSafeEqual("Xhsec_abc123", "whsec_abc123"), false);
  });

  it("returns false for different-length strings", () => {
    assert.equal(timingSafeEqual("short", "shorter"), false);
    assert.equal(timingSafeEqual("", "x"), false);
  });

  it("returns true for two empty strings", () => {
    assert.equal(timingSafeEqual("", ""), true);
  });

  it("handles multi-byte (non-ASCII) secrets correctly", () => {
    assert.equal(timingSafeEqual("секрет🔑", "секрет🔑"), true);
    assert.equal(timingSafeEqual("секрет🔑", "секрет🔒"), false);
  });

  it("compares UTF-8 bytes, not UTF-16 code-unit lengths", () => {
    // "é" is 1 UTF-16 code unit but 2 UTF-8 bytes; a charCodeAt-based
    // compare would treat these as same-length and XOR mismatched units,
    // while the byte-level compare short-circuits on byte length alone.
    assert.equal(timingSafeEqual("é", "ab"), false);
    assert.equal(timingSafeEqual("é", "e"), false);
  });

  it("distinguishes strings whose code units collide in the low byte", () => {
    // U+0101 (ā) and U+0001 share the low byte 0x01; a compare that only
    // XORs low bytes of code units would call these equal per-character.
    assert.equal(timingSafeEqual("ā", ""), false);
  });
});

describe("timingSafeEqual source structure (constant-time invariants)", () => {
  const SOURCE = readFileSync(
    path.join(process.cwd(), "lib", "timing-safe-equal.ts"),
    "utf8",
  );

  const fnBlock = SOURCE.match(/export function timingSafeEqual[\s\S]*?\n}/);

  it("encodes to UTF-8 bytes before comparing (TextEncoder, no charCodeAt)", () => {
    assert.ok(fnBlock, "timingSafeEqual function not found");
    assert.match(SOURCE, /new TextEncoder\(\)/);
    assert.match(fnBlock![0], /encoder\.encode/);
    // The compare itself must XOR bytes, never UTF-16 code units.
    assert.doesNotMatch(fnBlock![0], /charCodeAt/);
  });

  it("uses an XOR accumulator with no early exit inside the loop", () => {
    assert.ok(fnBlock, "timingSafeEqual function not found");
    const body = fnBlock![0];
    assert.match(body, /diff\s*\|=/);
    // The only `return false` allowed is the length-mismatch guard before
    // the loop — nothing after `for (` may bail out early.
    const forIdx = body.indexOf("for (");
    assert.ok(forIdx >= 0, "byte loop not found");
    assert.doesNotMatch(body.slice(forIdx), /return false/);
  });

  it("stays pure: no react-native / supabase / node-only imports", () => {
    assert.doesNotMatch(SOURCE, /from\s+['"]react-native/);
    assert.doesNotMatch(SOURCE, /from\s+['"]@\/lib\/supabase/);
    assert.doesNotMatch(SOURCE, /from\s+['"]node:/);
  });
});
