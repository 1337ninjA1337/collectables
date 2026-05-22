import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseStoredCurrency } from "@/lib/locale-helpers";
import { CURRENCY_KEY } from "@/lib/storage-keys";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("CURRENCY_KEY", () => {
  it("uses the documented collectables-currency-v1 slot", () => {
    assert.equal(CURRENCY_KEY, "collectables-currency-v1");
  });

  it("is removed by clearAllUserData so signing out wipes the preference", () => {
    const src = read("lib/storage-keys.ts");
    assert.match(src, /CURRENCY_KEY[^;]*"collectables-currency-v1"/);
    const clearBlock = src.match(/clearAllUserData[\s\S]*?\n\}/);
    assert.ok(clearBlock, "expected clearAllUserData function block");
    assert.match(clearBlock![0], /CURRENCY_KEY/);
  });
});

describe("parseStoredCurrency", () => {
  it("returns the upper-cased ISO 4217 code for a well-formed value", () => {
    assert.equal(parseStoredCurrency("USD"), "USD");
    assert.equal(parseStoredCurrency("eur"), "EUR");
    assert.equal(parseStoredCurrency(" jpy "), "JPY");
  });

  it("returns null for null, undefined, or empty strings", () => {
    assert.equal(parseStoredCurrency(null), null);
    assert.equal(parseStoredCurrency(undefined), null);
    assert.equal(parseStoredCurrency(""), null);
    assert.equal(parseStoredCurrency("   "), null);
  });

  it("returns null for non-ISO-4217 shapes (numeric, too short/long, symbols)", () => {
    assert.equal(parseStoredCurrency("US"), null);
    assert.equal(parseStoredCurrency("USDD"), null);
    assert.equal(parseStoredCurrency("123"), null);
    assert.equal(parseStoredCurrency("$$$"), null);
    assert.equal(parseStoredCurrency("us1"), null);
  });

  it("rejects non-string inputs defensively", () => {
    // @ts-expect-error guard: parseStoredCurrency must reject non-strings cleanly
    assert.equal(parseStoredCurrency(42), null);
    // @ts-expect-error guard: parseStoredCurrency must reject non-strings cleanly
    assert.equal(parseStoredCurrency({}), null);
  });
});

describe("locale-helpers persistence wiring", () => {
  it("exposes the read/write pair next to the currency map (the natural home)", () => {
    const src = read("lib/locale-helpers.ts");
    assert.match(src, /export\s+async\s+function\s+getUserPreferredCurrency\s*\(\s*\)/);
    assert.match(
      src,
      /export\s+async\s+function\s+setUserPreferredCurrency\s*\(\s*currency\s*:\s*string\s*\)/,
    );
  });

  it("reads/writes via the CURRENCY_KEY slot in storage-keys.ts", () => {
    const src = read("lib/locale-helpers.ts");
    assert.match(src, /import\s*\{\s*CURRENCY_KEY\s*\}\s*from\s*"@\/lib\/storage-keys"/);
    assert.match(src, /AsyncStorage\.getItem\(\s*CURRENCY_KEY\s*\)/);
    assert.match(src, /AsyncStorage\.setItem\(\s*CURRENCY_KEY\s*,/);
  });

  it("validates the input before writing (rejects junk via parseStoredCurrency)", () => {
    const src = read("lib/locale-helpers.ts");
    const setterMatch = src.match(/setUserPreferredCurrency[\s\S]*?\n\}\n/);
    assert.ok(setterMatch, "expected setUserPreferredCurrency function block");
    assert.match(setterMatch![0], /parseStoredCurrency\(\s*currency\s*\)/);
  });

  it("guards storage I/O with try/catch so a failure can't crash callers", () => {
    const src = read("lib/locale-helpers.ts");
    const getter = src.match(/getUserPreferredCurrency[\s\S]*?\n\}\n/);
    const setter = src.match(/setUserPreferredCurrency[\s\S]*?\n\}\n/);
    assert.ok(getter && setter);
    assert.match(getter![0], /try\s*\{[\s\S]*catch\s*\{/);
    assert.match(setter![0], /try\s*\{[\s\S]*catch\s*\{/);
  });
});

describe("forms hydrate from + persist to the preferred-currency slot", () => {
  it("app/create.tsx imports the read/write pair and wires both", () => {
    const src = read("app/create.tsx");
    assert.match(
      src,
      /import\s*\{[^}]*\bgetUserPreferredCurrency\b[^}]*\}\s*from\s*"@\/lib\/locale-helpers"/,
    );
    assert.match(
      src,
      /import\s*\{[^}]*\bsetUserPreferredCurrency\b[^}]*\}\s*from\s*"@\/lib\/locale-helpers"/,
    );
    // Hydration effect on mount.
    assert.match(src, /getUserPreferredCurrency\(\)/);
    // Persist on every currency selection.
    assert.match(src, /setUserPreferredCurrency\(/);
  });

  it("app/item/[id].tsx (listing sheet) hydrates and persists too", () => {
    const src = read("app/item/[id].tsx");
    assert.match(
      src,
      /import\s*\{[^}]*\bgetUserPreferredCurrency\b[^}]*\}\s*from\s*"@\/lib\/locale-helpers"/,
    );
    assert.match(src, /getUserPreferredCurrency\(\)/);
    assert.match(src, /setUserPreferredCurrency\(/);
  });
});
