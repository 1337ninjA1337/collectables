import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for bug-2c — syncing the user's app-wide display currency
 * onto the profiles row so it follows the account across devices. The column
 * is nullable: existing rows keep NULL and fall back to the device-local
 * AsyncStorage preference, then the language default.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("UserProfile type — displayCurrency field", () => {
  const src = read("lib/types.ts");
  it("declares `displayCurrency?: string | null` so legacy/offline rows can omit it", () => {
    assert.match(src, /UserProfile\s*=\s*\{[\s\S]*?displayCurrency\?:\s*string\s*\|\s*null;[\s\S]*?\};/);
  });
});

describe("DB shape — DbProfile + toUserProfile map display_currency", () => {
  const src = read("lib/supabase-profiles.ts");

  it("DbProfile row type carries the nullable display_currency column", () => {
    assert.match(src, /type\s+DbProfile\s*=\s*\{[\s\S]*?display_currency\?:\s*string\s*\|\s*null;[\s\S]*?\};/);
  });

  it("toUserProfile forwards row.display_currency onto displayCurrency (null fallback)", () => {
    assert.match(src, /displayCurrency:\s*row\.display_currency\s*\?\?\s*null,/);
  });

  it("updateMyProfileDisplayCurrency PATCHes the profile row", () => {
    assert.match(src, /export\s+async\s+function\s+updateMyProfileDisplayCurrency\(/);
    assert.match(src, /profileUpdateUrl\(supabaseUrl!,\s*userId\)/);
    assert.match(src, /method:\s*"PATCH"/);
    assert.match(src, /updateProfileDisplayCurrencyBody\(currency\)/);
  });

  it("guards on isSupabaseConfigured so offline/unconfigured builds no-op", () => {
    assert.match(
      src,
      /export\s+async\s+function\s+updateMyProfileDisplayCurrency\([\s\S]*?if\s*\(!isSupabaseConfigured\)\s*return;/,
    );
  });
});

describe("collections-context — cross-device display currency wiring", () => {
  const src = read("lib/collections-context.tsx");

  it("imports the profile fetch + sync helpers and the device-local fallbacks", () => {
    assert.match(src, /fetchProfileById,\s*\n\s*updateMyProfileDisplayCurrency,/);
    assert.match(src, /parseStoredCurrency,\s*\n\s*setUserPreferredCurrency,/);
  });

  it("hydrates from the profile on sign-in, profile value winning over device-local", () => {
    assert.match(src, /const\s+profile\s*=\s*await\s+fetchProfileById\(activeUser\.id\)/);
    assert.match(src, /const\s+profileCurrency\s*=\s*parseStoredCurrency\(profile\?\.displayCurrency\s*\?\?\s*null\)/);
    assert.match(src, /if\s*\(profileCurrency\)\s*\{\s*setDisplayCurrencyState\(profileCurrency\);/);
  });

  it("exposes setDisplayCurrency that validates, persists device-local, and syncs the profile", () => {
    assert.match(src, /setDisplayCurrency:\s*\(currency\)\s*=>\s*\{/);
    assert.match(src, /const\s+normalized\s*=\s*parseStoredCurrency\(currency\);/);
    assert.match(src, /if\s*\(!normalized\)\s*return;/);
    assert.match(src, /void\s+setUserPreferredCurrency\(normalized\);/);
    assert.match(
      src,
      /updateMyProfileDisplayCurrency\(user\.id,\s*normalized\)\.catch\(\(\)\s*=>\s*undefined\)/,
    );
  });

  it("declares setDisplayCurrency on the context value type", () => {
    assert.match(src, /setDisplayCurrency:\s*\(currency:\s*string\)\s*=>\s*void;/);
  });
});

describe("SQL migration + MANUAL-TASKS entry for the display_currency column", () => {
  it("ships supabase/migrations/20260528_profile_display_currency.sql with the ALTER TABLE", () => {
    const sql = read("supabase/migrations/20260528_profile_display_currency.sql");
    assert.match(sql, /ALTER\s+TABLE\s+public\.profiles/);
    assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+display_currency\s+text\s+NULL/);
  });

  it("MANUAL-TASKS.md documents the 20260528 migration so an operator can apply it", () => {
    const md = read("MANUAL-TASKS.md");
    assert.match(md, /20260528_profile_display_currency\.sql/);
    assert.match(md, /ADD COLUMN IF NOT EXISTS display_currency text NULL/);
  });
});
