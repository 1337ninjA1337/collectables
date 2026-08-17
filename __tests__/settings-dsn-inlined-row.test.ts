import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { localeKeys } from "@/lib/i18n-source";

const settingsSrc = readFileSync(
  path.join(process.cwd(), "app", "settings.tsx"),
  "utf8",
);
const i18nSrc = readFileSync(
  path.join(process.cwd(), "lib", "i18n-context.tsx"),
  "utf8",
);

const LANGUAGES = ["en", "ru", "be", "pl", "de", "es"] as const;

describe("settings — Sentry DSN inlined diagnostics row", () => {
  it("gates the row on dev builds or admins, never plain production users", () => {
    assert.match(
      settingsSrc,
      /const showDsnInlinedRow = isDevEnvironment\(\) \|\| isAdmin/,
      "the row must be visible only on dev builds or to admins",
    );
    assert.match(
      settingsSrc,
      /import \{ isDevEnvironment \} from "@\/lib\/dev-menu"/,
    );
    assert.match(
      settingsSrc,
      /const \{ isAdmin \} = useSocial\(\)/,
      "admin flag must come from the social context",
    );
    assert.match(
      settingsSrc,
      /\{showDsnInlinedRow && \(/,
      "the row must render conditionally on the gate",
    );
  });

  it("renders the ✅/❌ state from getSentryStatus().dsnPresent", () => {
    assert.match(
      settingsSrc,
      /testID="diagnostics-dsn-inlined"/,
      "row needs a stable testID",
    );
    assert.match(
      settingsSrc,
      /sentryStatus\.dsnPresent \? "✅" : "❌"/,
      "the indicator must be driven by the dsnPresent snapshot field",
    );
    assert.match(settingsSrc, /t\("diagnosticsDsnInlined"\)/);
  });

  it("has a diagnosticsDsnInlined translation in every language", () => {
    for (const code of LANGUAGES) {
      assert.ok(
        localeKeys(i18nSrc, code).has("diagnosticsDsnInlined"),
        `language '${code}' is missing the diagnosticsDsnInlined key`,
      );
    }
  });
});
