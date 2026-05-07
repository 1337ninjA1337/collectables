import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Sentry privacy declarations (App Store Connect + public policy)", () => {
  it("APPSTORE-SUBMISSION.md flips the Crash data / diagnostics row to Yes", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    // The row must now declare Yes (collected) / Yes (linked to user) / No (tracking).
    // Match the row liberally so future column-text edits don't break it.
    assert.match(
      src,
      /Crash data \/ diagnostics\s*\|\s*\*\*Yes\*\*\s*\|\s*Yes\s*\|\s*No\s*\|/,
      "Crash data row in App Privacy table must read 'Yes | Yes | No' to match Sentry usage",
    );
  });

  it("App Privacy table cites Sentry as the source for crash data", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    // Look at the Crash data row only.
    const rowMatch = src.match(
      /Crash data \/ diagnostics[\s\S]*?\n(?=\| [A-Za-z])/,
    );
    assert.ok(rowMatch, "Crash data row not found");
    const row = rowMatch[0];
    assert.match(
      row,
      /Sentry/,
      "Crash data row must name Sentry as the source",
    );
    assert.match(
      row,
      /scrubPII/,
      "Crash data row must reference the scrubPII helper so reviewers can audit the PII strip",
    );
  });

  it("APPSTORE-SUBMISSION.md documents the Settings opt-out path", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    assert.match(
      src,
      /Diagnostics\s*&\s*crash reports/i,
      "Privacy section should reference the in-app Settings opt-out toggle so reviewers know the user has control",
    );
    assert.match(
      src,
      /collectables-diagnostics-v1/,
      "Privacy section should mention the AsyncStorage key so engineers debugging the toggle know what to look for",
    );
  });

  it("APPSTORE-SUBMISSION.md includes the public privacy-policy Sentry paragraph", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    assert.match(
      src,
      /Suggested public privacy policy paragraph/i,
      "APPSTORE-SUBMISSION.md must surface a copy-paste-ready public privacy policy paragraph",
    );
    assert.match(
      src,
      /https:\/\/sentry\.io\/privacy\//,
      "Privacy paragraph must link to https://sentry.io/privacy/ as required by Apple's sub-processor disclosure rules",
    );
    assert.match(
      src,
      /sub-processor/i,
      "Privacy paragraph must classify Sentry as a sub-processor",
    );
  });

  it("APPSTORE-SUBMISSION.md still lists Sentry under 'Where it is stored'", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    assert.match(
      src,
      /Where it is stored \(Supabase, Cloudinary, Sentry\)/,
      "The privacy-policy outline must include Sentry alongside Supabase + Cloudinary so engineers writing PRIVACY.md don't drop it",
    );
  });

  it("APPSTORE-SUBMISSION.md no longer claims 'no Sentry/Crashlytics wired'", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    assert.doesNotMatch(
      src,
      /no Sentry\/Crashlytics wired/i,
      "Stale 'no Sentry/Crashlytics wired' claim must be removed once Sentry ships in the bundle",
    );
  });
});
