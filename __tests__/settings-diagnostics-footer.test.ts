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

const FOOTER_KEYS = [
  "diagnosticsCrashFooterLastSent",
  "diagnosticsCrashFooterNoneSent",
  "diagnosticsCrashFooterDisabled",
] as const;

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

describe("settings — diagnostics crash-report footer", () => {
  it("reads the Sentry snapshot via getSentryStatus and ticks with useNow", () => {
    assert.match(settingsSrc, /import \{ getSentryStatus \} from "@\/lib\/sentry"/);
    assert.match(settingsSrc, /import \{ useNow \} from "@\/lib\/use-now"/);
    assert.match(settingsSrc, /useNow\(\)/);
    assert.match(settingsSrc, /getSentryStatus\(\)/);
  });

  it("gates the three footer states on toggle + lastEventSentAt", () => {
    assert.match(
      settingsSrc,
      /!diagnosticsEnabled\s*\?\s*t\("diagnosticsCrashFooterDisabled"\)/,
      "disabled toggle must render the disabled footer",
    );
    assert.match(
      settingsSrc,
      /sentryStatus\.lastEventSentAt\s*\?\s*relativeDateLabel\(/,
      "a stamped event must render the relative 'last sent' label",
    );
    assert.match(
      settingsSrc,
      /formatRelativeDate\(sentryStatus\.lastEventSentAt\)/,
      "the stamp must flow through the localised relative formatter",
    );
    assert.match(
      settingsSrc,
      /t\("diagnosticsCrashFooterNoneSent"\)/,
      "enabled-but-quiet state must render the nothing-sent footer",
    );
  });

  it("renders the footer inside the diagnostics card", () => {
    assert.match(
      settingsSrc,
      /styles\.diagnosticsFooter\}? testID="diagnostics-crash-footer"/,
    );
    assert.match(settingsSrc, /\{crashFooter\}/);
    assert.match(settingsSrc, /diagnosticsFooter: \{/);
  });

  it("declares the footer keys in every language map (no en fallback)", () => {
    for (const code of LANGUAGES) {
      const block = languageBlock(code);
      for (const key of FOOTER_KEYS) {
        assert.ok(
          block.includes(`${key}:`),
          `${code} must declare ${key} directly`,
        );
      }
    }
  });

  it("declares the four base diagnostics keys in every non-EN language (regression: EN-only card)", () => {
    for (const code of LANGUAGES.filter((c) => c !== "en")) {
      const block = languageBlock(code);
      for (const key of [
        "diagnosticsTitle",
        "diagnosticsHint",
        "diagnosticsEnabled",
        "diagnosticsDisabled",
      ]) {
        assert.ok(
          block.includes(`${key}:`),
          `${code} must declare ${key} directly instead of inheriting English`,
        );
      }
    }
  });
});
