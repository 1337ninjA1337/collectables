import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
} from "../lib/analytics-events";

/**
 * Event descriptions are EN-only by design today — they live in
 * `ANALYTICS_EVENTS[name].description` and surface in the Power BI schema doc
 * and the admin/dev diagnostics list, not in end-user UI. If a future change
 * (e.g. the GDPR opt-out disclosure) promotes a description into the i18n
 * layer, the convention is a `analyticsEventDesc_<event_name>` key. This test
 * pins the invariant: a description is either English-only (taxonomy entry,
 * no i18n key anywhere) or fully translated (the key present in EVERY
 * language block) — a partial translation must never ship to a non-English
 * user.
 */

const i18nSrc = readFileSync(
  path.join(process.cwd(), "lib", "i18n-context.tsx"),
  "utf8",
);

const LANGUAGES = ["en", "ru", "be", "pl", "de", "es"] as const;

/** Slice one language's object literal out of the i18n source. */
function languageBlock(code: string): string {
  const decl =
    code === "en" ? "const en = {" : `const ${code}: TranslationMap = {`;
  const start = i18nSrc.indexOf(decl);
  assert.ok(start >= 0, `declaration for '${code}' not found`);
  const rest = i18nSrc.slice(start + decl.length);
  const next = rest.search(
    /\nconst \w+(?:: \w+)? = \{|\nconst \w+: TranslationMap = \{/,
  );
  return next >= 0 ? rest.slice(0, next) : rest;
}

describe("analytics event descriptions — i18n parity", () => {
  it("every event has a non-empty English description in the taxonomy", () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      assert.ok(
        ANALYTICS_EVENTS[name].description.trim().length > 0,
        `event '${name}' is missing its English description`,
      );
    }
  });

  it("a translated description exists in all languages or none", () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      const key = `analyticsEventDesc_${name}:`;
      const present = LANGUAGES.filter((code) =>
        languageBlock(code).includes(key),
      );
      assert.ok(
        present.length === 0 || present.length === LANGUAGES.length,
        `event '${name}' has a partial translation set — present in [${present.join(", ")}], ` +
          `must be all of [${LANGUAGES.join(", ")}] or none`,
      );
    }
  });

  it("no stray analyticsEventDesc_ key for an event outside the taxonomy", () => {
    const keys = i18nSrc.match(/analyticsEventDesc_(\w+):/g) ?? [];
    for (const raw of keys) {
      const name = raw.slice("analyticsEventDesc_".length, -1);
      assert.ok(
        (ANALYTICS_EVENT_NAMES as readonly string[]).includes(name),
        `i18n key '${raw}' names an event that is not in ANALYTICS_EVENTS`,
      );
    }
  });
});
