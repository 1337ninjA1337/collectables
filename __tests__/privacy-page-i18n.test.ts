import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  PRIVACY_DEFAULT_LANGUAGE,
  PRIVACY_PAGE_LANGUAGES,
  renderLanguagePicker,
  renderPrivacyPage,
} from "@/lib/privacy-page";

/**
 * Guards the translated /privacy pages (GDPR Art. 12 — the Sentry
 * sub-processor disclosure must be readable in every language the app
 * surfaces):
 *
 * 1. `PRIVACY_PAGE_LANGUAGES` stays in lockstep with the i18n
 *    `languageOptions` picker (parsed from source — `lib/i18n-context.tsx`
 *    imports react-native peers, same pattern as
 *    `i18n-locale-map-parity.test.ts`).
 * 2. Every non-English language has a tracked `PRIVACY.md.<code>` whose
 *    Sentry paragraph keeps the disclosure-critical facts (sub-processor
 *    links, PII strip, retention window, opt-out path).
 * 3. The language picker is script-free links that survive the page's
 *    `default-src 'none'` CSP.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const I18N_SOURCE = read("lib/i18n-context.tsx");

function parseLanguageOptions(): { code: string; label: string }[] {
  const block = I18N_SOURCE.match(
    /languageOptions\s*:\s*\{\s*code[\s\S]*?\}\s*\[\s*\]\s*=\s*\[([\s\S]*?)\];/,
  );
  assert.ok(block, "languageOptions declaration not found in lib/i18n-context.tsx");
  const options: { code: string; label: string }[] = [];
  const entryRegex = /code:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(block![1])) !== null) {
    options.push({ code: match[1], label: match[2] });
  }
  return options;
}

describe("PRIVACY_PAGE_LANGUAGES ↔ i18n languageOptions parity", () => {
  const i18nOptions = parseLanguageOptions();

  it("i18n languageOptions parses to a non-empty list", () => {
    assert.ok(i18nOptions.length > 0);
  });

  it("declares exactly the same language codes as the in-app picker", () => {
    assert.deepEqual(
      [...PRIVACY_PAGE_LANGUAGES.map((l) => l.code)].sort(),
      i18nOptions.map((o) => o.code).sort(),
      "PRIVACY_PAGE_LANGUAGES drifted from languageOptions in lib/i18n-context.tsx — " +
        "a language the app surfaces has no /privacy translation (or vice versa)",
    );
  });

  it("uses the same native-name labels as the in-app picker", () => {
    for (const { code, label } of i18nOptions) {
      const page = PRIVACY_PAGE_LANGUAGES.find((l) => l.code === code);
      assert.equal(page?.label, label, `label for "${code}" drifted`);
    }
  });

  it("English is the default (canonical full-policy) language", () => {
    assert.equal(PRIVACY_DEFAULT_LANGUAGE, "en");
    assert.ok(PRIVACY_PAGE_LANGUAGES.some((l) => l.code === "en"));
  });
});

describe("translated PRIVACY.md.<code> files", () => {
  const translated = PRIVACY_PAGE_LANGUAGES.filter(
    (l) => l.code !== PRIVACY_DEFAULT_LANGUAGE,
  );

  it("covers every non-English language", () => {
    for (const { code } of translated) {
      assert.ok(
        existsSync(path.join(ROOT, `PRIVACY.md.${code}`)),
        `PRIVACY.md.${code} missing — the deploy script will fail the build`,
      );
    }
  });

  for (const { code } of translated) {
    it(`PRIVACY.md.${code} keeps the disclosure-critical Sentry facts`, () => {
      const src = read(`PRIVACY.md.${code}`);
      assert.match(src, /Sentry/, "must name Sentry");
      assert.match(
        src,
        /https:\/\/sentry\.io\/privacy\//,
        "must link Sentry's privacy policy",
      );
      assert.match(
        src,
        /https:\/\/sentry\.io\/legal\/dpa\//,
        "must link Sentry's DPA",
      );
      assert.match(src, /`Authorization`/, "must mention the stripped Authorization header");
      assert.match(src, /90/, "must state the 90-day retention window");
      assert.match(src, /Supabase/, "must disclose the Supabase user identifier in the payload");
    });
  }
});

describe("renderLanguagePicker", () => {
  it("marks the active language as text (aria-current), not a link", () => {
    const nav = renderLanguagePicker("en");
    assert.match(nav, /<span aria-current="page">English<\/span>/);
    assert.ok(!/href="[^"]*"[^>]*>English/.test(nav), "active language must not be a link");
  });

  it("links translations one level down from the English root page", () => {
    const nav = renderLanguagePicker("en");
    assert.match(nav, /<a href="ru\/" lang="ru" hreflang="ru">Русский<\/a>/);
    assert.match(nav, /<a href="de\/" lang="de" hreflang="de">Deutsch<\/a>/);
  });

  it("links English up and sibling translations across from a translated page", () => {
    const nav = renderLanguagePicker("ru");
    assert.match(nav, /<a href="\.\.\/" lang="en" hreflang="en">English<\/a>/);
    assert.match(nav, /<a href="\.\.\/de\/" lang="de" hreflang="de">Deutsch<\/a>/);
    assert.match(nav, /<span aria-current="page">Русский<\/span>/);
  });

  it("emits no scripts (page CSP is default-src 'none')", () => {
    for (const { code } of PRIVACY_PAGE_LANGUAGES) {
      assert.ok(!renderLanguagePicker(code).includes("<script"));
    }
  });
});

describe("renderPrivacyPage — translated pages", () => {
  it("stamps the document language and embeds the picker", () => {
    const page = renderPrivacyPage(read("PRIVACY.md.ru"), "ru");
    assert.match(page, /<html lang="ru">/);
    assert.match(page, /<nav class="lang" aria-label="Language">/);
    assert.ok(!page.includes("<script"), "policy page must stay script-free");
    assert.match(page, /Отчёты о сбоях/);
  });

  it("keeps the English page as the default with the picker on it too", () => {
    const page = renderPrivacyPage(read("PRIVACY.md"));
    assert.match(page, /<html lang="en">/);
    assert.match(page, /<span aria-current="page">English<\/span>/);
  });
});

describe("build wiring — translated pages ship with every deploy", () => {
  it("build-spa-fallback.ts emits dist/privacy/<code>/index.html and fails closed when a translation is missing", () => {
    const src = read("scripts/build-spa-fallback.ts");
    assert.match(src, /PRIVACY_PAGE_LANGUAGES/);
    assert.match(src, /PRIVACY\.md\.\$\{code\}/);
    assert.match(src, /PRIVACY\.md\.\$\{code\} not found[\s\S]*?process\.exit\(1\)/);
  });
});
