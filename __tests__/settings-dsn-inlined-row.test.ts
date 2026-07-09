import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const settingsSrc = readFileSync(
  path.join(process.cwd(), "app", "settings.tsx"),
  "utf8",
);
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
  const next = rest.search(/\nconst \w+(?:: \w+)? = \{|\nconst \w+: TranslationMap = \{/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

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
      assert.match(
        languageBlock(code),
        /diagnosticsDsnInlined:/,
        `language '${code}' is missing the diagnosticsDsnInlined key`,
      );
    }
  });
});
