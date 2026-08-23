import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  BUNDLE_SMOKE_I18N_KEYS,
  BUNDLE_SMOKE_LANGUAGE_CODES,
  BUNDLE_SMOKE_PROVIDERS,
  BUNDLE_SMOKE_TOKENS,
  PRIVACY_BODY_BASELINE_TOLERANCE,
  PRIVACY_BODY_BASELINE_WORDS,
  PRIVACY_BODY_SIMILARITY_MIN_WORDS,
  PRIVACY_BODY_SIMILARITY_THRESHOLD,
  PRIVACY_PAGE_MARKER,
  PRIVACY_PAGE_RELATIVE_PATH,
  PRIVACY_PAGE_TARGETS,
  evaluateBundleSmoke,
  evaluatePrivacyPage,
  evaluatePrivacyPages,
  extractPrivacyPageBodyText,
  extractPrivacyPageHeading,
  formatBundleSmokeReport,
  formatPrivacyPageFailure,
  formatPrivacyPageWordCounts,
  formatPrivacyPagesReport,
  privacyBodySimilarity,
  privacyBodyWords,
  type BundleSmokeToken,
  type PrivacyPageFailureCode,
  type PrivacyPageInput,
} from "../lib/bundle-smoke";
import { LINT_ALL_EXEMPT } from "../lib/lint-guards";
import { PRIVACY_PAGE_LANGUAGES } from "../lib/privacy-languages";
import { renderPrivacyPage } from "../lib/privacy-page";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile as read, repoPath } from "./helpers/repo-file";

/**
 * Pins the post-build smoke check that replaced ci.yml's and deploy.yml's
 * inline `grep` loops.
 *
 * The shell version had three problems this file exists to keep closed: it
 * searched only the FIRST chunk (`ls … | head -1`), it never asked whether
 * `dist/` was newer than the source tree, and its watched token lists lived in
 * YAML where nothing could check them against the app. The first two are
 * behaviour (asserted here and, for freshness, in `bundle-premise.test.ts`);
 * the third is the parity block at the bottom, which derives the language list
 * from `AppLanguage` and the provider list from `app/_layout.tsx`.
 */


const SCRIPT = read("scripts/check-bundle-smoke.ts");

/** Every watched token, concatenated — a bundle that would pass. */
const passingChunk = (): string =>
  BUNDLE_SMOKE_TOKENS.map((entry) => entry.token).join(";");

describe("evaluateBundleSmoke — token presence", () => {
  it("passes when one chunk contains every token", () => {
    const result = evaluateBundleSmoke([passingChunk()]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.equal(result.chunkCount, 1);
  });

  it("passes when the tokens are SPREAD across chunks", () => {
    // The bug in the shell version: `head -1` searched chunk one only, so a
    // Metro chunking change that moved a key into chunk two failed a check
    // whose premise ("the bundle contains this key") was still true.
    const chunks = BUNDLE_SMOKE_TOKENS.map((entry) => entry.token);
    const result = evaluateBundleSmoke(chunks);
    assert.equal(result.ok, true);
    assert.equal(result.chunkCount, BUNDLE_SMOKE_TOKENS.length);
  });

  it("reports the token that is absent from every chunk", () => {
    const dropped = BUNDLE_SMOKE_TOKENS[0];
    const text = BUNDLE_SMOKE_TOKENS.slice(1)
      .map((entry) => entry.token)
      .join(";");
    const result = evaluateBundleSmoke([text, text]);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.missing.map((entry) => entry.token),
      [dropped.token],
    );
  });

  it("reports EVERY missing token, not just the first", () => {
    const result = evaluateBundleSmoke([""]);
    assert.equal(result.missing.length, BUNDLE_SMOKE_TOKENS.length);
  });

  it("fails over zero chunks rather than passing vacuously", () => {
    // The premise assertion upstream refuses to get this far, but a helper
    // that returned ok:true for an empty list would be the exact bug the
    // premise work was about.
    const result = evaluateBundleSmoke([]);
    assert.equal(result.ok, false);
    assert.equal(result.chunkCount, 0);
  });

  it("accepts an explicit token list (so a caller can narrow the check)", () => {
    const custom: BundleSmokeToken[] = [{ kind: "provider", token: "Zzz" }];
    assert.equal(evaluateBundleSmoke(["Zzz"], custom).ok, true);
    assert.equal(evaluateBundleSmoke(["Yyy"], custom).ok, false);
  });

  it("matches substrings literally, not as a regex", () => {
    const custom: BundleSmokeToken[] = [{ kind: "i18n-key", token: "a.c" }];
    assert.equal(evaluateBundleSmoke(["abc"], custom).ok, false);
    assert.equal(evaluateBundleSmoke(["a.c"], custom).ok, true);
  });

  it("does not mutate its inputs", () => {
    const tokens = [...BUNDLE_SMOKE_TOKENS];
    const chunks = [passingChunk()];
    evaluateBundleSmoke(chunks, tokens);
    assert.equal(chunks.length, 1);
    assert.equal(tokens.length, BUNDLE_SMOKE_TOKENS.length);
  });
});

describe("the watched token list", () => {
  it("quotes the language codes", () => {
    // An unquoted "de" matches half the identifiers in any minified bundle,
    // so the check would pass no matter what shipped.
    for (const code of BUNDLE_SMOKE_LANGUAGE_CODES) {
      const entry = BUNDLE_SMOKE_TOKENS.find(
        (candidate) => candidate.kind === "language" && candidate.token.includes(code),
      );
      assert.ok(entry, `language ${code} watched`);
      assert.equal(entry?.token, `"${code}"`);
    }
  });

  it("has no duplicate tokens", () => {
    const seen = new Set(BUNDLE_SMOKE_TOKENS.map((entry) => entry.token));
    assert.equal(seen.size, BUNDLE_SMOKE_TOKENS.length);
  });

  it("covers all three kinds", () => {
    const kinds = new Set(BUNDLE_SMOKE_TOKENS.map((entry) => entry.kind));
    assert.deepEqual([...kinds].sort(), ["i18n-key", "language", "provider"]);
  });

  it("is the union of the three declared lists", () => {
    assert.equal(
      BUNDLE_SMOKE_TOKENS.length,
      BUNDLE_SMOKE_I18N_KEYS.length +
        BUNDLE_SMOKE_PROVIDERS.length +
        BUNDLE_SMOKE_LANGUAGE_CODES.length,
    );
  });
});

describe("formatBundleSmokeReport", () => {
  it("names the check and the chunk count on success", () => {
    const message = formatBundleSmokeReport(
      "check-bundle-smoke",
      evaluateBundleSmoke([passingChunk(), passingChunk()]),
    );
    assert.match(message, /^check-bundle-smoke:/);
    assert.match(message, /2 chunk\(s\)/);
  });

  it("names each missing token and its kind", () => {
    const result = evaluateBundleSmoke([""], [
      { kind: "language", token: '"de"' },
      { kind: "provider", token: "AuthProvider" },
    ]);
    const message = formatBundleSmokeReport("check-bundle-smoke", result);
    assert.match(message, /i18n language code/);
    assert.match(message, /provider/);
    // JSON.stringify keeps the quotes the token carries visible (escaped) —
    // the log must show `"\"de\""`, not a bare `de` the reader would mistake
    // for an unquoted search.
    assert.ok(message.includes(JSON.stringify('"de"')));
    assert.match(message, /AuthProvider/);
    assert.equal(message.split("\n").length, 2);
  });

  it("says ERROR on failure and does not on success", () => {
    assert.match(
      formatBundleSmokeReport("c", evaluateBundleSmoke([""])),
      /ERROR/,
    );
    assert.doesNotMatch(
      formatBundleSmokeReport("c", evaluateBundleSmoke([passingChunk()])),
      /ERROR/,
    );
  });
});

const EN_TARGET = PRIVACY_PAGE_TARGETS.find((t) => t.code === "en");
const RU_TARGET = PRIVACY_PAGE_TARGETS.find((t) => t.code === "ru");
const DE_TARGET = PRIVACY_PAGE_TARGETS.find((t) => t.code === "de");

/**
 * A body of distinct words, long enough to clear the word floor.
 *
 * Distinct rather than shared filler: 45 identical words plus one language
 * marker scores 0.978 against every other page and would make every fixture in
 * this file trip `near_english_body`. The words carry the code so no two pages
 * overlap at all, which is the fixture equivalent of six real translations.
 */
const wordSequence = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_, i) => `${prefix}word${i}`).join(" ");

/**
 * Sized from the language's recorded baseline, so a fixture page is the size
 * the drift gate expects that language to be. Codes with no baseline (the
 * synthetic ones a few cases use) fall back to just over the floor.
 */
const bodyWordsFor = (code: string): string =>
  wordSequence(
    code,
    PRIVACY_BODY_BASELINE_WORDS[code] ?? PRIVACY_BODY_SIMILARITY_MIN_WORDS + 5,
  );

/**
 * A page that passes every gate, for the language given. Heading AND body
 * carry the code because the gates are no longer per-page: a translation whose
 * `<h1>` or whose policy text equals the English one is an untranslated page,
 * so a fixture that gave all six the same prose would be a fixture that cannot
 * pass. The body clears `PRIVACY_BODY_SIMILARITY_MIN_WORDS` for the same
 * reason it grew a heading and then a body in the two runs before this one —
 * a fixture that cannot pass the check it feeds is worse than no fixture.
 */
const renderedPage = (code: string): string =>
  `<html lang="${code}"><title>Collectables — ${PRIVACY_PAGE_MARKER}</title><h1>Policy ${code}</h1><p>${bodyWordsFor(code)}</p></html>`;

describe("PRIVACY_PAGE_TARGETS", () => {
  it("covers every language the page is offered in", () => {
    assert.deepEqual(
      PRIVACY_PAGE_TARGETS.map((target) => target.code),
      PRIVACY_PAGE_LANGUAGES.map((language) => language.code),
    );
  });

  it("checks all six pages, not only the English one", () => {
    // The shell version looked at dist/privacy/index.html alone while
    // build-spa-fallback.ts emits six — so the five GDPR Art. 12 disclosure
    // translations were the one surface with a legal edge that nothing gated.
    assert.equal(PRIVACY_PAGE_TARGETS.length, 6);
  });

  it("puts English at the canonical path and translations one level down", () => {
    assert.equal(EN_TARGET?.relativePath, PRIVACY_PAGE_RELATIVE_PATH);
    assert.equal(RU_TARGET?.relativePath, "dist/privacy/ru/index.html");
  });

  it("matches the paths build-spa-fallback.ts writes", () => {
    const builder = read("scripts/build-spa-fallback.ts");
    assert.ok(builder.includes('path.join(privacyDir, "index.html")'));
    assert.ok(builder.includes('path.join(langDir, "index.html")'));
    assert.ok(builder.includes("PRIVACY_PAGE_LANGUAGES"));
  });
});

describe("evaluatePrivacyPage", () => {
  it("passes on a rendered page in the expected language", () => {
    assert.ok(EN_TARGET);
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: true,
      text: renderedPage("en"),
    });
    assert.equal(verdict.ok, true);
  });

  it("fails when the file is absent", () => {
    assert.ok(EN_TARGET);
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: false,
      text: null,
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false && verdict.code, "missing_file");
  });

  it("reports an unreadable file as missing_file — same fix, one message", () => {
    assert.ok(EN_TARGET);
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: true,
      text: null,
    });
    assert.equal(verdict.ok === false && verdict.code, "missing_file");
  });

  it("fails when the file is not a privacy page at all", () => {
    assert.ok(EN_TARGET);
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: true,
      text: "<html></html>",
    });
    assert.equal(verdict.ok === false && verdict.code, "missing_marker");
  });

  it("fails when the WRONG translation was written to the path", () => {
    // renderPrivacyPage's <title> is the English string in every language, so
    // a marker-only check passes on the English page copied into /privacy/ru/.
    // The <html lang> attribute is what distinguishes them.
    assert.ok(RU_TARGET);
    const verdict = evaluatePrivacyPage({
      target: RU_TARGET,
      exists: true,
      text: renderedPage("en"),
    });
    assert.equal(verdict.ok === false && verdict.code, "wrong_language");
  });

  it("is not satisfied by the language picker's own lang= attributes", () => {
    // Every page renders `<a lang="ru" hreflang="ru">` for the picker, so a
    // bare `lang="ru"` substring is present in all six — the first draft of
    // this check used exactly that and passed a deliberately mis-copied page.
    assert.ok(RU_TARGET);
    const englishPageWithPicker = `<html lang="en"><title>${PRIVACY_PAGE_MARKER}</title><nav><a href="ru/" lang="ru" hreflang="ru">Русский</a></nav><h1>Policy</h1></html>`;
    const verdict = evaluatePrivacyPage({
      target: RU_TARGET,
      exists: true,
      text: englishPageWithPicker,
    });
    assert.equal(verdict.ok === false && verdict.code, "wrong_language");
  });

  it("accepts the REAL renderer's output for every language", () => {
    // The gates are substring checks against a template this suite does not
    // own; a renderer reword (a self-closing <html>, a reordered attribute)
    // would break all six at once, and only running the real thing notices.
    for (const target of PRIVACY_PAGE_TARGETS) {
      const verdict = evaluatePrivacyPage({
        target,
        exists: true,
        text: renderPrivacyPage(
          `# Policy ${target.code}\n\n${bodyWordsFor(target.code)}\n`,
          target.code,
        ),
      });
      assert.equal(
        verdict.ok,
        true,
        `${target.code}: ${verdict.ok === false ? verdict.code : ""}`,
      );
    }
  });

  it("fails when the chrome rendered but the policy body did not", () => {
    // renderPrivacyPage("") emits the title and the language picker and no
    // policy — a page that passes a title grep and contains no policy.
    assert.ok(EN_TARGET);
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: true,
      text: `<html lang="en"><title>${PRIVACY_PAGE_MARKER}</title></html>`,
    });
    assert.equal(verdict.ok === false && verdict.code, "empty_body");
  });

  it("fails a page whose body is a heading and a dozen words", () => {
    // `<h1` proves the heading rendered; the body under it is what the marker
    // was named for and what it could never see. A truncated PRIVACY.md.pl
    // ships as a title and one line and passed every gate before this.
    assert.ok(EN_TARGET);
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: true,
      text: `<html lang="en"><title>${PRIVACY_PAGE_MARKER}</title><h1>Policy</h1><p>We collect a little data and that is the whole policy.</p></html>`,
    });
    assert.equal(verdict.ok === false && verdict.code, "body_too_short");
  });

  it("counts the words it rejected, so the log says how short", () => {
    assert.ok(EN_TARGET);
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: true,
      text: `<html lang="en"><title>${PRIVACY_PAGE_MARKER}</title><h1>Policy</h1><p>one two three</p></html>`,
    });
    assert.equal(verdict.ok === false && verdict.detail, "3 word(s)");
    assert.ok(
      formatPrivacyPageFailure("c", {
        target: EN_TARGET,
        code: "body_too_short",
        detail: "3 word(s)",
      }).includes("3 word(s)"),
    );
  });

  it("reports empty_body, not body_too_short, when nothing rendered at all", () => {
    // Most-specific-last: a page with no heading has no body worth counting,
    // and "the policy body rendered empty" is the truer thing to say.
    assert.ok(EN_TARGET);
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: true,
      text: `<html lang="en"><title>${PRIVACY_PAGE_MARKER}</title></html>`,
    });
    assert.equal(verdict.ok === false && verdict.code, "empty_body");
  });

  it("accepts a body at exactly the floor", () => {
    assert.ok(EN_TARGET);
    const atFloor = Array.from(
      { length: PRIVACY_BODY_SIMILARITY_MIN_WORDS },
      (_, i) => `w${i}`,
    ).join(" ");
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: true,
      text: `<html lang="en"><title>${PRIVACY_PAGE_MARKER}</title><h1>Policy</h1><p>${atFloor}</p></html>`,
    });
    assert.equal(verdict.ok, true);
  });

  it("returns the body word count it measured, instead of discarding it", () => {
    assert.ok(EN_TARGET);
    const text = renderedPage("en");
    const verdict = evaluatePrivacyPage({
      target: EN_TARGET,
      exists: true,
      text,
    });
    assert.equal(verdict.ok, true);
    assert.equal(
      verdict.ok ? verdict.wordCount : -1,
      privacyBodyWords(extractPrivacyPageBodyText(text) ?? "").length,
    );
  });

  it("guarantees every page it passes can be measured by the ratio", () => {
    // The invariant the shared constant buys: `privacyBodySimilarity` returning
    // null is what silently disables the near-copy gate, and nothing that
    // clears these gates can produce it. If the two floors ever drift apart,
    // this fails.
    for (const target of PRIVACY_PAGE_TARGETS) {
      const text = renderedPage(target.code);
      assert.equal(evaluatePrivacyPage({ target, exists: true, text }).ok, true);
      const body = extractPrivacyPageBodyText(text) ?? "";
      assert.notEqual(
        privacyBodySimilarity(body, body),
        null,
        `${target.code}: passed the gates but is too short to compare`,
      );
    }
  });

  it("has a distinct message per failure code", () => {
    assert.ok(EN_TARGET);
    const codes: PrivacyPageFailureCode[] = [
      "missing_file",
      "missing_marker",
      "wrong_language",
      "empty_body",
      "untranslated_heading",
      "untranslated_body",
      "near_english_body",
      "body_too_short",
    ];
    const messages = codes.map((code) =>
      formatPrivacyPageFailure("c", { target: EN_TARGET, code }),
    );
    assert.equal(new Set(messages).size, codes.length);
    for (const message of messages) {
      assert.match(message, /^c: ERROR — /);
      assert.ok(message.includes(PRIVACY_PAGE_RELATIVE_PATH));
    }
  });

  it("quotes the measurement in the message of the code that made one", () => {
    // near_english_body is the only code that measures anything, and 97% vs
    // 91% is the difference between a copy with edits and a page worth a
    // second look — the reader should not have to re-run the check to see it.
    assert.ok(DE_TARGET);
    const message = formatPrivacyPageFailure("c", {
      target: DE_TARGET,
      code: "near_english_body",
      detail: "97%",
    });
    assert.ok(message.includes("97%"));
  });

  it("still reads without a measurement, for a caller that has none", () => {
    assert.ok(DE_TARGET);
    const message = formatPrivacyPageFailure("c", {
      target: DE_TARGET,
      code: "near_english_body",
    });
    assert.doesNotMatch(message, /undefined/);
  });

  it("names the offending path, not always the English one", () => {
    assert.ok(RU_TARGET);
    const message = formatPrivacyPageFailure("c", {
      target: RU_TARGET,
      code: "missing_file",
    });
    assert.ok(message.includes("dist/privacy/ru/index.html"));
  });
});

describe("evaluatePrivacyPages", () => {
  const allGood = (): PrivacyPageInput[] =>
    PRIVACY_PAGE_TARGETS.map((target) => ({
      target,
      exists: true,
      text: renderedPage(target.code),
    }));

  it("passes when every page rendered", () => {
    const result = evaluatePrivacyPages(allGood());
    assert.equal(result.ok, true);
    assert.equal(result.checked, PRIVACY_PAGE_TARGETS.length);
    assert.deepEqual(result.failures, []);
  });

  it("reports EVERY broken page, not just the first", () => {
    const inputs = allGood().map((input) => ({
      ...input,
      exists: false,
      text: null,
    }));
    const result = evaluatePrivacyPages(inputs);
    assert.equal(result.failures.length, PRIVACY_PAGE_TARGETS.length);
  });

  it("fails the run when one translation is missing", () => {
    const inputs = allGood();
    const result = evaluatePrivacyPages(
      inputs.map((input) =>
        input.target.code === "de"
          ? { ...input, exists: false, text: null }
          : input,
      ),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.failures.map((failure) => failure.target.code),
      ["de"],
    );
  });

  it("refuses an empty input list rather than passing vacuously", () => {
    const result = evaluatePrivacyPages([]);
    assert.equal(result.ok, false);
    assert.equal(result.checked, 0);
  });

  it("says how many pages it checked on success", () => {
    const message = formatPrivacyPagesReport(
      "c",
      evaluatePrivacyPages(allGood()),
    );
    assert.match(message, /6 privacy page\(s\)/);
    assert.doesNotMatch(message, /ERROR/);
  });

  it("quotes the body word range on success", () => {
    // The whole point of keeping the counts: a translation shrinking over
    // several commits is visible here, rather than only on the commit that
    // pushes it under the floor and turns the build red with no history.
    const result = evaluatePrivacyPages(allGood());
    assert.equal(result.ok, true);
    const sizes = PRIVACY_PAGE_TARGETS.map(
      (target) => PRIVACY_BODY_BASELINE_WORDS[target.code],
    );
    assert.match(
      formatPrivacyPagesReport("c", result),
      new RegExp(`\\(${Math.min(...sizes)}-${Math.max(...sizes)} words\\)`),
    );
  });

  it("names zero-page runs explicitly", () => {
    const message = formatPrivacyPagesReport("c", evaluatePrivacyPages([]));
    assert.match(message, /ERROR/);
    assert.match(message, /0 privacy pages/);
  });

  it("records one body word count per passing page, in input order", () => {
    const result = evaluatePrivacyPages(allGood());
    assert.deepEqual(
      result.wordCounts.map((entry) => entry.code),
      PRIVACY_PAGE_TARGETS.map((target) => target.code),
    );
    // Each fixture body is sized from its language's baseline, so the counts
    // are checkable without restating the fixture's arithmetic here.
    for (const entry of result.wordCounts) {
      assert.equal(entry.words, PRIVACY_BODY_BASELINE_WORDS[entry.code]);
    }
  });

  it("gives no word count to a page that failed its own gates", () => {
    const result = evaluatePrivacyPages(
      allGood().map((input) =>
        input.target.code === "de"
          ? { ...input, exists: false, text: null }
          : input,
      ),
    );
    assert.deepEqual(
      result.wordCounts.map((entry) => entry.code),
      PRIVACY_PAGE_TARGETS.map((target) => target.code).filter(
        (code) => code !== "de",
      ),
    );
  });

  it("still counts a page that passed per-page and failed a cross-page gate", () => {
    // The count is a property of the page's own body; being a copy of the
    // English one does not make its size unknown.
    const result = evaluatePrivacyPages(
      allGood().map((input) =>
        input.target.code === "de"
          ? { ...input, text: renderedPage("en").replace('lang="en"', 'lang="de"') }
          : input,
      ),
    );
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.wordCounts.length, PRIVACY_PAGE_TARGETS.length);
  });

  it("has a non-empty word count list exactly when the run passed", () => {
    // The invariant the success report leans on: a passing run always has
    // numbers to quote, so the parenthetical can never go quietly missing.
    const scenarios: PrivacyPageInput[][] = [
      allGood(),
      [],
      allGood().map((input) => ({ ...input, exists: false, text: null })),
      allGood().map((input) =>
        input.target.code === "pl" ? { ...input, text: "<html></html>" } : input,
      ),
    ];
    const verdicts = scenarios.map((inputs) => evaluatePrivacyPages(inputs));
    for (const result of verdicts) {
      if (!result.ok) continue;
      assert.equal(result.wordCounts.length, result.checked);
    }
    // …and the scenario list actually exercises both sides, so the loop above
    // cannot pass by never entering its body.
    assert.deepEqual(
      verdicts.map((result) => result.ok),
      [true, false, false, false],
    );
  });

  it("fails a translation that carries the ENGLISH heading", () => {
    // The failure the per-page gates structurally cannot see: PRIVACY.md.de
    // holding the English text renders a file that exists, has the title, is
    // marked `<html lang="de">` (the renderer's argument, not the content) and
    // has a body. Every gate passes and the disclosure is untranslated.
    const english = renderedPage("en");
    const englishHeading =
      english.match(/<h1>(.*)<\/h1>/)?.[1] ?? "unreachable";
    const result = evaluatePrivacyPages(
      allGood().map((input) =>
        input.target.code === "de"
          ? {
              ...input,
              text: `<html lang="de"><title>${PRIVACY_PAGE_MARKER}</title><h1>${englishHeading}</h1><p>${bodyWordsFor("de")}</p></html>`,
            }
          : input,
      ),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [
      { target: DE_TARGET, code: "untranslated_heading" },
    ]);
  });

  it("never accuses the English page of matching itself", () => {
    const result = evaluatePrivacyPages(allGood());
    assert.equal(result.ok, true);
    assert.ok(
      !result.failures.some((f) => f.target.code === "en"),
      "en is the baseline, not a candidate",
    );
  });

  it("compares heading TEXT, so inline markup is not a translation", () => {
    // renderInline runs over the heading: `**Collectables**` in one source
    // file and not in the other would make two identical sentences compare
    // unequal, which is a diff no reader would call a translation.
    const result = evaluatePrivacyPages(
      allGood().map((input) =>
        input.target.code === "pl"
          ? {
              ...input,
              text: `<html lang="pl"><title>${PRIVACY_PAGE_MARKER}</title><h1 id="top">  Policy\n  <strong>en</strong> </h1><p>${bodyWordsFor("pl")}</p></html>`,
            }
          : input,
      ),
    );
    assert.deepEqual(
      result.failures.map((f) => `${f.target.code}:${f.code}`),
      ["pl:untranslated_heading"],
    );
  });

  it("skips the comparison when the English page is itself broken", () => {
    // One cause, one failure: a missing English page must not also brand the
    // five translations untranslated against a baseline that does not exist.
    const result = evaluatePrivacyPages(
      allGood().map((input) =>
        input.target.code === "en"
          ? { ...input, exists: false, text: null }
          : input,
      ),
    );
    assert.deepEqual(result.failures, [
      { target: EN_TARGET, code: "missing_file" },
    ]);
  });

  it("skips the comparison when no English page was passed in at all", () => {
    const translationsOnly = allGood().filter(
      (input) => input.target.code !== "en",
    );
    const result = evaluatePrivacyPages(translationsOnly);
    assert.equal(result.ok, true);
    assert.equal(result.checked, PRIVACY_PAGE_TARGETS.length - 1);
  });

  it("passes over the REAL tracked policy files, all six rendered", () => {
    // The check is worth nothing if the shipped translations cannot satisfy
    // it — and this is the assertion that actually reads PRIVACY.md.<code>
    // and proves each one's heading is a different sentence.
    const inputs: PrivacyPageInput[] = PRIVACY_PAGE_TARGETS.map((target) => ({
      target,
      exists: true,
      text: renderPrivacyPage(
        read(target.code === "en" ? "PRIVACY.md" : `PRIVACY.md.${target.code}`),
        target.code,
      ),
    }));
    const result = evaluatePrivacyPages(inputs);
    assert.equal(
      result.ok,
      true,
      result.failures.map((f) => `${f.target.code}:${f.code}`).join(", "),
    );
  });

  it("fails a translated TITLE over an English body", () => {
    // The state a half-finished translation is left in, and the one the
    // heading check reads as done: `# Datenschutzerklärung` rendered over the
    // English disclosure. The body is the half a reader is owed.
    const englishBody =
      renderedPage("en").match(/<\/h1>([\s\S]*)$/)?.[1] ?? "unreachable";
    const result = evaluatePrivacyPages(
      allGood().map((input) =>
        input.target.code === "de"
          ? {
              ...input,
              text: `<html lang="de"><title>${PRIVACY_PAGE_MARKER}</title><h1>Datenschutzerklärung</h1>${englishBody}`,
            }
          : input,
      ),
    );
    assert.deepEqual(result.failures, [
      { target: DE_TARGET, code: "untranslated_body" },
    ]);
  });

  /**
   * The fixture pages above carry two-word bodies, which the word floor
   * deliberately compares for equality only. These build bodies long enough
   * for the ratio to apply.
   */
  const ENGLISH_WORDS = Array.from({ length: 80 }, (_, i) => `english${i}`);

  const longPage = (code: string, words: readonly string[]): string =>
    `<html lang="${code}"><title>Collectables — ${PRIVACY_PAGE_MARKER}</title><h1>Policy ${code}</h1><p>${words.join(" ")}</p></html>`;

  /**
   * `evaluatePrivacyPages` with each page's own measured size as its baseline,
   * which makes `body_size_drift` a no-op by construction.
   *
   * These cases are about PROSE, and their fixtures are deliberately the wrong
   * size for their language (80-word bodies against real baselines of 169 and
   * 1171). Neutralising the size gate here keeps each case asserting the one
   * thing it was written for; the drift gate has its own cases below.
   */
  const evaluateProse = (inputs: readonly PrivacyPageInput[]) =>
    evaluatePrivacyPages(
      inputs,
      Object.fromEntries(
        inputs.map((input) => [
          input.target.code,
          privacyBodyWords(
            extractPrivacyPageBodyText(input.text ?? "") ?? "",
          ).length,
        ]),
      ),
    );

  /** allGood(), with a long English baseline and one long translation. */
  const withLongBodies = (
    code: string,
    words: readonly string[],
  ): PrivacyPageInput[] =>
    allGood().map((input) => {
      if (input.target.code === "en") {
        return { ...input, text: longPage("en", ENGLISH_WORDS) };
      }
      if (input.target.code === code) {
        return { ...input, text: longPage(code, words) };
      }
      return input;
    });

  it("fails the English body with one sentence appended", () => {
    // The hole an equality test leaves: one changed character is enough to
    // make two documents unequal, so `untranslated_body` never fires on the
    // English disclosure with a German sentence pasted at the end.
    const result = evaluateProse(
      withLongBodies("de", [
        ...ENGLISH_WORDS,
        "und",
        "eine",
        "deutsche",
        "ergaenzung",
      ]),
    );
    assert.deepEqual(
      result.failures.map((f) => `${f.target.code}:${f.code}`),
      ["de:near_english_body"],
    );
  });

  it("reports the measured overlap so the log says how close it was", () => {
    const result = evaluateProse(
      withLongBodies("de", [...ENGLISH_WORDS, "angehaengter", "satz"]),
    );
    assert.equal(result.failures[0]?.detail, "100%");
    assert.ok(
      formatPrivacyPagesReport("c", result).includes("100%"),
      "the percentage has to reach the report, not just the failure",
    );
  });

  it("fails a body that is the English one with a handful of words swapped", () => {
    // 8 of 80 words changed — 90% shared, exactly at the threshold, which
    // fails: the boundary belongs on the strict side or the constant is a
    // suggestion rather than a limit.
    const eightSwapped = [
      ...ENGLISH_WORDS.slice(0, 72),
      ...Array.from({ length: 8 }, (_, i) => `deutsch${i}`),
    ];
    const result = evaluateProse(withLongBodies("pl", eightSwapped));
    assert.deepEqual(
      result.failures.map((f) => `${f.target.code}:${f.code}`),
      ["pl:near_english_body"],
    );
    assert.equal(result.failures[0]?.detail, "90%");
  });

  it("passes a long body that is genuinely a different document", () => {
    const result = evaluateProse(
      withLongBodies(
        "es",
        Array.from({ length: 80 }, (_, i) => `espanol${i}`),
      ),
    );
    assert.equal(result.ok, true, JSON.stringify(result.failures));
  });

  it("reports untranslated_body, not near_english_body, on an exact copy", () => {
    // Two codes because the diagnoses differ: "this file IS the English
    // policy" and "this file is the English policy with edits" send the
    // reader to different places. Exact is checked first.
    const result = evaluateProse(withLongBodies("de", ENGLISH_WORDS));
    assert.deepEqual(
      result.failures.map((f) => `${f.target.code}:${f.code}`),
      ["de:untranslated_body"],
    );
  });

  it("reports the SHORTNESS of a short copy, not the copying", () => {
    // A body under the floor is broken on its own terms, and saying "this is
    // the English text" about twelve words sends the reader to diff two files
    // when the real answer is that one of them is a stub. The floor gate runs
    // first for that reason.
    const result = evaluatePrivacyPages(
      allGood().map((input) =>
        input.target.code === "de"
          ? {
              ...input,
              text: `<html lang="de"><title>${PRIVACY_PAGE_MARKER}</title><h1>Datenschutz</h1><p>We collect a little data.</p></html>`,
            }
          : input,
      ),
    );
    assert.deepEqual(
      result.failures.map((f) => `${f.target.code}:${f.code}`),
      ["de:body_too_short"],
    );
  });

  it("keeps the REAL translations far from the threshold, not just under it", () => {
    // A margin, not a pass: the shipped bodies share only proper nouns, URLs
    // and the effective date with English. If a future translation drifts
    // toward the line this fails while there is still room to think, rather
    // than turning the gate red on a legitimate file one day.
    const bodyOf = (code: string): string =>
      extractPrivacyPageBodyText(
        renderPrivacyPage(
          read(code === "en" ? "PRIVACY.md" : `PRIVACY.md.${code}`),
          code,
        ),
      ) ?? "";
    const english = bodyOf("en");
    for (const { code } of PRIVACY_PAGE_LANGUAGES) {
      if (code === "en") continue;
      const similarity = privacyBodySimilarity(bodyOf(code), english);
      assert.ok(similarity !== null, `${code}: body too short to compare`);
      assert.ok(
        similarity < 0.5,
        `${code}: ${similarity} shared with English — too close to the ${PRIVACY_BODY_SIMILARITY_THRESHOLD} threshold`,
      );
    }
  });

  it("would fail the REAL English policy retitled in Spanish and padded", () => {
    // The mutation the equality check structurally cannot make: the real
    // English markdown under a Spanish heading with one paragraph appended,
    // rendered by the real renderer into the Spanish path. Before the ratio
    // this passed every gate.
    const englishMarkdown = read("PRIVACY.md");
    const retitled = englishMarkdown.replace(
      /^# .*$/m,
      "# Política de privacidad",
    );
    const inputs: PrivacyPageInput[] = PRIVACY_PAGE_TARGETS.map((target) => ({
      target,
      exists: true,
      text: renderPrivacyPage(
        target.code === "en"
          ? englishMarkdown
          : target.code === "es"
            ? `${retitled}\n\nUn párrafo añadido al final del documento.\n`
            : read(`PRIVACY.md.${target.code}`),
        target.code,
      ),
    }));
    const result = evaluatePrivacyPages(inputs);
    assert.deepEqual(
      result.failures.map((f) => `${f.target.code}:${f.code}`),
      ["es:near_english_body"],
    );
  });

  it("reports the HEADING, not the body, when the whole page is English", () => {
    // A wholly-English translation fails both comparisons; one failure per
    // page, and "the heading is English" is the smaller, truer thing to say.
    const result = evaluatePrivacyPages(
      allGood().map((input) =>
        input.target.code === "de"
          ? { ...input, text: renderedPage("en").replace('lang="en"', 'lang="de"') }
          : input,
      ),
    );
    assert.deepEqual(result.failures, [
      { target: DE_TARGET, code: "untranslated_heading" },
    ]);
  });

  it("fails heading-only pages rather than quietly skipping their comparison", () => {
    // This used to pass: six pages with a heading and no body extracted to six
    // null bodies, the comparison was skipped as "nothing to compare", and the
    // run reported six pages present and rendered. `empty_body` could not see
    // it either — `<h1` proves a heading rendered, which is the half that DID
    // work. The word floor is what turns that silence into six failures.
    const headingOnly = (code: string): string =>
      `<html lang="${code}"><title>${PRIVACY_PAGE_MARKER}</title><h1>Policy ${code}</h1></html>`;
    const result = evaluatePrivacyPages(
      PRIVACY_PAGE_TARGETS.map((target) => ({
        target,
        exists: true,
        text: headingOnly(target.code),
      })),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.failures.map((f) => f.code),
      PRIVACY_PAGE_TARGETS.map(() => "body_too_short"),
    );
  });

  it("still skips the comparison when the English page is absent entirely", () => {
    // The null-baseline path the test above used to cover: it is now only
    // reachable when the English page fails its own gates, and one cause must
    // still produce one failure rather than six.
    const translationsOnly = allGood().filter(
      (input) => input.target.code !== "en",
    );
    assert.equal(evaluatePrivacyPages(translationsOnly).ok, true);
  });

  it("would fail if a translated policy file were replaced by the English one", () => {
    // The mutation the previous test cannot make on its own: same real
    // renderer, same real English markdown, written to the Spanish path.
    const englishMarkdown = read("PRIVACY.md");
    const inputs: PrivacyPageInput[] = PRIVACY_PAGE_TARGETS.map((target) => ({
      target,
      exists: true,
      text: renderPrivacyPage(
        target.code === "en" || target.code === "es"
          ? englishMarkdown
          : read(`PRIVACY.md.${target.code}`),
        target.code,
      ),
    }));
    const result = evaluatePrivacyPages(inputs);
    assert.deepEqual(
      result.failures.map((f) => `${f.target.code}:${f.code}`),
      ["es:untranslated_heading"],
    );
  });
});

describe("privacyBodyWords", () => {
  it("lowercases and splits on everything that is not a letter or digit", () => {
    assert.deepEqual(privacyBodyWords("We store  Data, in 2026."), [
      "we",
      "store",
      "data",
      "in",
      "2026",
    ]);
  });

  it("keeps Cyrillic, which \\w would throw away", () => {
    // ru and be are not Latin: a `\w`-based split reduces those bodies to
    // their digits and scores every pair of them 1.0 on the numbers alone.
    assert.deepEqual(privacyBodyWords("Мы храним данные"), [
      "мы",
      "храним",
      "данные",
    ]);
  });

  it("returns nothing for text with no words in it", () => {
    assert.deepEqual(privacyBodyWords("—  … ,"), []);
  });
});

describe("privacyBodySimilarity", () => {
  const words = (prefix: string, n: number): string =>
    Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

  it("scores an identical body 1", () => {
    const body = words("w", 50);
    assert.equal(privacyBodySimilarity(body, body), 1);
  });

  it("scores a body that is the other one PLUS additions 1", () => {
    // The measure is over the shorter body on purpose: appending to the
    // English disclosure is the cheapest way to dress it up as a translation,
    // and it must not move the number at all.
    const english = words("w", 50);
    assert.equal(
      privacyBodySimilarity(`${english} ${words("extra", 10)}`, english),
      1,
    );
  });

  it("scores a body that is the other one TRUNCATED 1", () => {
    // Half the English policy is still the English policy.
    const english = words("w", 80);
    const half = words("w", 40);
    assert.equal(privacyBodySimilarity(half, english), 1);
  });

  it("scores disjoint bodies 0", () => {
    assert.equal(privacyBodySimilarity(words("a", 50), words("b", 50)), 0);
  });

  it("is symmetric — argument order is not a verdict", () => {
    const a = `${words("w", 40)} ${words("extra", 20)}`;
    const b = words("w", 45);
    assert.equal(privacyBodySimilarity(a, b), privacyBodySimilarity(b, a));
  });

  it("counts words as a multiset, so repetition cannot borrow matches", () => {
    // Set intersection scores this pair 1.0: every distinct word of the left
    // body appears on the right. Counting min(count) per word gives the
    // 50-word body 5 matches for its 5 occurrences and no more.
    const repeated = `${"data ".repeat(45).trim()} ${words("x", 5)}`;
    const sparse = `data ${words("y", 60)}`;
    const similarity = privacyBodySimilarity(repeated, sparse);
    assert.ok(similarity !== null);
    assert.ok(
      similarity < 0.1,
      `expected the repetition not to dominate, got ${similarity}`,
    );
  });

  it("refuses bodies below the word floor rather than guessing", () => {
    // A ratio over a handful of words is noise: two unrelated notices sharing
    // `Collectables`, a URL and a date score 1.0 without being related.
    const short = words("w", PRIVACY_BODY_SIMILARITY_MIN_WORDS - 1);
    assert.equal(privacyBodySimilarity(short, short), null);
    assert.equal(privacyBodySimilarity(short, words("w", 100)), null);
    assert.equal(privacyBodySimilarity(words("w", 100), short), null);
  });

  it("compares at exactly the floor", () => {
    const atFloor = words("w", PRIVACY_BODY_SIMILARITY_MIN_WORDS);
    assert.equal(privacyBodySimilarity(atFloor, atFloor), 1);
  });

  it("sits the floor well below the shortest shipped body", () => {
    // The floor is only safe while no real page is judged by a ratio it is
    // too small for — if a translation ever shrinks to the floor, the ratio
    // silently stops running on it and the gate goes quiet.
    const shortest = Math.min(
      ...PRIVACY_PAGE_LANGUAGES.map(
        ({ code }) =>
          privacyBodyWords(
            extractPrivacyPageBodyText(
              renderPrivacyPage(
                read(code === "en" ? "PRIVACY.md" : `PRIVACY.md.${code}`),
                code,
              ),
            ) ?? "",
          ).length,
      ),
    );
    assert.ok(
      shortest > PRIVACY_BODY_SIMILARITY_MIN_WORDS * 2,
      `shortest shipped body is ${shortest} words against a ${PRIVACY_BODY_SIMILARITY_MIN_WORDS}-word floor`,
    );
  });

  it("keeps the threshold strictly between the real and the copied", () => {
    assert.ok(PRIVACY_BODY_SIMILARITY_THRESHOLD > 0.5);
    assert.ok(PRIVACY_BODY_SIMILARITY_THRESHOLD < 1);
  });
});

describe("PRIVACY_BODY_BASELINE_WORDS", () => {
  const measure = (code: string): number =>
    privacyBodyWords(
      extractPrivacyPageBodyText(
        renderPrivacyPage(
          read(code === "en" ? "PRIVACY.md" : `PRIVACY.md.${code}`),
          code,
        ),
      ) ?? "",
    ).length;

  it("has an entry for every language the page is offered in", () => {
    // A seventh language without a baseline would otherwise be exempt from the
    // one check that notices a policy shrinking.
    assert.deepEqual(
      Object.keys(PRIVACY_BODY_BASELINE_WORDS).sort(),
      PRIVACY_PAGE_LANGUAGES.map((language) => language.code).sort(),
    );
  });

  it("matches what the tracked policy files actually render to", () => {
    // The baselines are hand-written, so a typo here would silently widen or
    // shift someone's band. Re-measuring from the source is what makes the
    // table a fact rather than a claim.
    for (const { code } of PRIVACY_PAGE_LANGUAGES) {
      assert.equal(
        PRIVACY_BODY_BASELINE_WORDS[code],
        measure(code),
        `${code}: baseline is stale — measured ${measure(code)}`,
      );
    }
  });

  it("keeps every baseline clear of the word floor's band", () => {
    // The floor and the band are two gates on the same number; a baseline low
    // enough that its lower bound fell under the floor would make the drift
    // message unreachable for that language.
    for (const [code, baseline] of Object.entries(
      PRIVACY_BODY_BASELINE_WORDS,
    )) {
      assert.ok(
        baseline * (1 - PRIVACY_BODY_BASELINE_TOLERANCE) >
          PRIVACY_BODY_SIMILARITY_MIN_WORDS,
        `${code}: a ±${PRIVACY_BODY_BASELINE_TOLERANCE} band around ${baseline} reaches under the ${PRIVACY_BODY_SIMILARITY_MIN_WORDS}-word floor`,
      );
    }
  });

  it("is a band, not an equality — ordinary wording work does not fail", () => {
    assert.ok(PRIVACY_BODY_BASELINE_TOLERANCE > 0);
    assert.ok(PRIVACY_BODY_BASELINE_TOLERANCE < 1);
  });
});

describe("body_size_drift", () => {
  const pageOf = (code: string, wordCount: number): string =>
    `<html lang="${code}"><title>Collectables — ${PRIVACY_PAGE_MARKER}</title><h1>Policy ${code}</h1><p>${wordSequence(code, wordCount)}</p></html>`;

  /** allGood(), with one language's body resized to `wordCount`. */
  const resized = (code: string, wordCount: number): PrivacyPageInput[] =>
    PRIVACY_PAGE_TARGETS.map((target) => ({
      target,
      exists: true,
      text:
        target.code === code
          ? pageOf(code, wordCount)
          : renderedPage(target.code),
    }));

  const codesOf = (result: {
    failures: readonly { target: { code: string }; code: string }[];
  }): string[] => result.failures.map((f) => `${f.target.code}:${f.code}`);

  it("fails a policy that lost a third of itself", () => {
    // The case the 40-word floor cannot see: 780 words is two thirds of the
    // English policy and nineteen times the floor.
    const result = evaluatePrivacyPages(resized("en", 780));
    assert.deepEqual(codesOf(result), ["en:body_size_drift"]);
  });

  it("quotes the measurement, the baseline and the direction", () => {
    const result = evaluatePrivacyPages(resized("de", 100));
    assert.equal(
      result.failures[0]?.detail,
      "100 word(s) against a baseline of 169 (-41%)",
    );
    const message = formatPrivacyPagesReport("c", result);
    assert.match(message, /-41%/);
    // The fix has to be in the message: this gate is the one that goes red on
    // a legitimate amendment, so it must say what to do about it.
    assert.match(message, /PRIVACY_BODY_BASELINE_WORDS\["de"\]/);
  });

  it("marks growth with a + so the direction is readable at a glance", () => {
    const result = evaluatePrivacyPages(resized("es", 400));
    assert.match(result.failures[0]?.detail ?? "", /\(\+75%\)/);
  });

  it("accepts both edges of the band and rejects just outside them", () => {
    for (const code of ["ru", "es"]) {
      const baseline = PRIVACY_BODY_BASELINE_WORDS[code];
      const low = Math.ceil(baseline * (1 - PRIVACY_BODY_BASELINE_TOLERANCE));
      const high = Math.floor(baseline * (1 + PRIVACY_BODY_BASELINE_TOLERANCE));
      assert.deepEqual(codesOf(evaluatePrivacyPages(resized(code, low))), []);
      assert.deepEqual(codesOf(evaluatePrivacyPages(resized(code, high))), []);
      assert.deepEqual(codesOf(evaluatePrivacyPages(resized(code, low - 1))), [
        `${code}:body_size_drift`,
      ]);
      assert.deepEqual(codesOf(evaluatePrivacyPages(resized(code, high + 1))), [
        `${code}:body_size_drift`,
      ]);
    }
  });

  it("reports the SHORTNESS of a stub, not its drift", () => {
    // Both gates fire on a twelve-word page. `body_too_short` is the one that
    // also explains why the near-copy ratio went quiet for it.
    const result = evaluatePrivacyPages(resized("pl", 12));
    assert.deepEqual(codesOf(result), ["pl:body_too_short"]);
  });

  it("reports the COPYING of an English paste, not its drift", () => {
    // `PRIVACY.md.de` holding the English disclosure is both a copy and 593%
    // of its recorded size; only one of those two sentences says what to do.
    const result = evaluatePrivacyPages(
      PRIVACY_PAGE_TARGETS.map((target) => ({
        target,
        exists: true,
        text:
          target.code === "de"
            ? renderedPage("en").replace('lang="en"', 'lang="de"')
            : renderedPage(target.code),
      })),
    );
    assert.deepEqual(codesOf(result), ["de:untranslated_heading"]);
  });

  it("fails a language with no recorded baseline rather than exempting it", () => {
    const target = { code: "zz", relativePath: "dist/privacy/zz/index.html" };
    const result = evaluatePrivacyPages([
      ...PRIVACY_PAGE_TARGETS.map((t) => ({
        target: t,
        exists: true,
        text: renderedPage(t.code),
      })),
      { target, exists: true, text: renderedPage("zz") },
    ]);
    assert.deepEqual(codesOf(result), ["zz:missing_baseline"]);
    assert.match(
      formatPrivacyPagesReport("c", result),
      /PRIVACY_BODY_BASELINE_WORDS/,
    );
  });

  it("passes the six pages the build actually emits", () => {
    // The table and the files have to agree end to end, not only per-page:
    // this is the assertion that would go red on the merge that truncates a
    // policy, in the second `verify` leg rather than after a 3-minute export.
    const result = evaluatePrivacyPages(
      PRIVACY_PAGE_TARGETS.map((target) => ({
        target,
        exists: true,
        text: renderPrivacyPage(
          read(
            target.code === "en" ? "PRIVACY.md" : `PRIVACY.md.${target.code}`,
          ),
          target.code,
        ),
      })),
    );
    assert.equal(result.ok, true, JSON.stringify(result.failures));
  });
});

describe("formatPrivacyPageWordCounts", () => {
  it("renders the min and max of the set", () => {
    assert.equal(
      formatPrivacyPageWordCounts([
        { code: "en", words: 1171 },
        { code: "de", words: 169 },
        { code: "es", words: 229 },
      ]),
      "169-1171 words",
    );
  });

  it("renders one number when every page measured the same", () => {
    // `169-169 words` reads like a bug in the formatter rather than a fact
    // about the pages.
    assert.equal(
      formatPrivacyPageWordCounts([
        { code: "en", words: 169 },
        { code: "de", words: 169 },
      ]),
      "169 words",
    );
  });

  it("returns null for an empty set rather than an empty range", () => {
    assert.equal(formatPrivacyPageWordCounts([]), null);
  });

  it("leaves the verdict line clean when there is nothing to quote", () => {
    // Unreachable on a passing run, handled anyway: a format helper is not
    // where a build guard should crash.
    const message = formatPrivacyPagesReport("c", {
      ok: true,
      failures: [],
      checked: 6,
      wordCounts: [],
    });
    assert.equal(message, "c: 6 privacy page(s) present and rendered.");
  });

  it("quotes the real shipped bodies' range", () => {
    const result = evaluatePrivacyPages(
      PRIVACY_PAGE_TARGETS.map((target) => ({
        target,
        exists: true,
        text: renderPrivacyPage(
          read(target.code === "en" ? "PRIVACY.md" : `PRIVACY.md.${target.code}`),
          target.code,
        ),
      })),
    );
    assert.equal(result.ok, true);
    // The six real pages are not all the same length — German compounds what
    // Spanish spells out — so the report must show a range, not one number.
    const range = formatPrivacyPageWordCounts(result.wordCounts);
    assert.match(range ?? "", /^\d+-\d+ words$/);
    assert.match(formatPrivacyPagesReport("c", result), /\(\d+-\d+ words\)\.$/);
    for (const entry of result.wordCounts) {
      assert.ok(
        entry.words >= PRIVACY_BODY_SIMILARITY_MIN_WORDS,
        `${entry.code}: ${entry.words} words is under the floor it passed`,
      );
    }
  });
});

describe("extractPrivacyPageHeading", () => {
  it("returns the heading text with tags stripped", () => {
    assert.equal(
      extractPrivacyPageHeading("<h1>Collectables — <em>Policy</em></h1>"),
      "Collectables — Policy",
    );
  });

  it("collapses whitespace so indentation is not a difference", () => {
    assert.equal(
      extractPrivacyPageHeading("<h1>\n  Polityka   prywatności\n</h1>"),
      "Polityka prywatności",
    );
  });

  it("reads through attributes on the tag", () => {
    assert.equal(extractPrivacyPageHeading('<h1 id="t">Policy</h1>'), "Policy");
  });

  it("takes the FIRST heading when a page has several", () => {
    assert.equal(
      extractPrivacyPageHeading("<h1>First</h1><h1>Second</h1>"),
      "First",
    );
  });

  it("is null on an unclosed or empty heading rather than guessing", () => {
    assert.equal(extractPrivacyPageHeading("<h1>no close"), null);
    assert.equal(extractPrivacyPageHeading("<h1></h1>"), null);
    assert.equal(extractPrivacyPageHeading("<h1>   </h1>"), null);
    assert.equal(extractPrivacyPageHeading("<p>body only</p>"), null);
  });

  it("pulls the real renderer's heading out of a real page", () => {
    const page = renderPrivacyPage(read("PRIVACY.md.de"), "de");
    assert.equal(
      extractPrivacyPageHeading(page),
      "Collectables — Datenschutzerklärung",
    );
  });
});

describe("extractPrivacyPageBodyText", () => {
  it("returns everything after the heading, as text", () => {
    assert.equal(
      extractPrivacyPageBodyText("<h1>Title</h1><p>One</p><ul><li>Two</li></ul>"),
      "One Two",
    );
  });

  it("does not run words together where a tag separated them", () => {
    // Tags become a space, not nothing: `<p>a</p><p>b</p>` collapsing to "ab"
    // would make two different documents compare equal often enough to matter.
    assert.equal(extractPrivacyPageBodyText("<h1>T</h1><p>a</p><p>b</p>"), "a b");
  });

  it("excludes the heading and everything before it", () => {
    // The language picker and the style block sit above the body, and they are
    // byte-identical across all six pages — including them would make every
    // comparison a comparison of the chrome.
    const body = extractPrivacyPageBodyText(
      '<style>body{color:red}</style><nav class="lang"><a href="ru/">Русский</a></nav><h1>Title</h1><p>Only this</p>',
    );
    assert.equal(body, "Only this");
  });

  it("is null when there is no heading to cut at, or nothing follows it", () => {
    assert.equal(extractPrivacyPageBodyText("<p>no heading</p>"), null);
    assert.equal(extractPrivacyPageBodyText("<h1>Title</h1>"), null);
    assert.equal(extractPrivacyPageBodyText("<h1>Title</h1>\n  \n"), null);
  });

  it("gives the six REAL pages six different bodies", () => {
    // The assertion the whole comparison rests on: the translations are
    // Sentry-disclosure subsets, so their prose must differ from the English
    // policy's and from each other's.
    const bodies = PRIVACY_PAGE_TARGETS.map((target) =>
      extractPrivacyPageBodyText(
        renderPrivacyPage(
          read(target.code === "en" ? "PRIVACY.md" : `PRIVACY.md.${target.code}`),
          target.code,
        ),
      ),
    );
    assert.ok(
      bodies.every((body) => body !== null && body.length > 200),
      "every page has a substantial body",
    );
    assert.equal(new Set(bodies).size, PRIVACY_PAGE_TARGETS.length);
  });
});

describe("scripts/check-bundle-smoke.ts", () => {
  it("asserts the shared premise before reading anything", () => {
    assert.match(SCRIPT, /assertBundlePremise\(CHECK_NAME\)/);
    const premise = SCRIPT.indexOf("assertBundlePremise(CHECK_NAME)");
    const readChunks = SCRIPT.indexOf("readFileSync");
    assert.ok(premise !== -1 && readChunks !== -1);
    assert.ok(
      premise < SCRIPT.slice(premise).indexOf("chunkTexts") + premise + 1,
      "premise precedes the chunk read",
    );
  });

  it("takes its chunk list from the premise, not its own readdir", () => {
    // Three hand-written copies of the glob is how one of them ends up
    // matching a different set — the reason assertBundlePremise returns the
    // paths at all.
    assert.doesNotMatch(SCRIPT, /readdirSync/);
    assert.doesNotMatch(SCRIPT, /_expo/);
  });

  it("reads every chunk, not just the first", () => {
    assert.match(SCRIPT, /bundlePaths\.map\(/);
    assert.doesNotMatch(SCRIPT, /bundlePaths\[0\]/);
  });

  it("reports both halves before exiting", () => {
    const exit = SCRIPT.indexOf("process.exit(1)");
    const privacyReport = SCRIPT.indexOf("formatPrivacyPagesReport");
    assert.ok(privacyReport !== -1 && exit !== -1);
    assert.ok(
      privacyReport < exit,
      "a fail-fast chain would hide the privacy failure behind a token failure",
    );
  });

  it("reads every emitted privacy page, not just the English one", () => {
    assert.match(SCRIPT, /PRIVACY_PAGE_TARGETS\.map\(/);
    assert.doesNotMatch(SCRIPT, /PRIVACY_PAGE_RELATIVE_PATH/);
  });

  it("exits non-zero when either half fails", () => {
    assert.match(SCRIPT, /if \(!smoke\.ok \|\| !privacy\.ok\) process\.exit\(1\)/);
  });
});

describe("wiring", () => {
  it("is an npm script", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(
      pkg.scripts["lint:bundle-smoke"],
      "tsx scripts/check-bundle-smoke.ts",
    );
  });

  it("is exempt from lint:all with a reason naming the build output", () => {
    // lint:all runs on the working tree alone; this guard needs dist/, so it
    // must be declared exempt or the registry parity test fails.
    const reason = LINT_ALL_EXEMPT["lint:bundle-smoke"];
    assert.ok(reason, "declared in LINT_ALL_EXEMPT");
    assert.match(reason, /dist\//);
  });

  it("runs in ci.yml after the web build", () => {
    const ci = read(".github/workflows/ci.yml");
    const build = ci.indexOf("- name: Web build");
    const smoke = ci.indexOf("npm run lint:bundle-smoke");
    assert.ok(build !== -1 && smoke !== -1);
    assert.ok(smoke > build);
  });

  it("runs in deploy.yml too, so the shipped artifact is the checked one", () => {
    const deploy = read(".github/workflows/deploy.yml");
    assert.ok(deploy.includes("npm run lint:bundle-smoke"));
  });

  it("runs in release.yml, which carried a DRIFTED copy of the same check", () => {
    // release.yml's inline version never grew the six-language loop ci.yml
    // has, so a dropped translation map failed CI and passed the release
    // gate. Three copies of a check is three chances to be one behind.
    const release = read(".github/workflows/release.yml");
    const build = release.indexOf("- name: Web build");
    const smoke = release.indexOf("npm run lint:bundle-smoke");
    assert.ok(build !== -1 && smoke !== -1);
    assert.ok(smoke > build);
  });

  it("leaves no workflow grepping the bundle for a watched token by hand", () => {
    const dir = repoPath(".github", "workflows");
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
      const body = read(path.join(".github", "workflows", file));
      for (const provider of BUNDLE_SMOKE_PROVIDERS) {
        assert.ok(
          !body.includes(`for PROVIDER in ${provider}`),
          `${file} still hand-rolls the provider grep`,
        );
      }
      assert.ok(
        !body.includes(`for KEY in ${BUNDLE_SMOKE_I18N_KEYS[0]}`),
        `${file} still hand-rolls the i18n key grep`,
      );
    }
  });
});

describe("token parity with the app", () => {
  it("watches exactly the languages AppLanguage declares", () => {
    // lib/i18n-context.tsx imports react-native, so it cannot be imported
    // here — parse the union instead. A seventh language added to the app
    // and not to the watch list would otherwise never be smoke-checked.
    const source = readI18nSource();
    const match = source.match(/export type AppLanguage =([^;]+);/);
    assert.ok(match, "AppLanguage union found");
    const declared = [...(match?.[1] ?? "").matchAll(/"([a-z-]+)"/g)].map(
      (hit) => hit[1],
    );
    assert.deepEqual(
      [...declared].sort(),
      [...BUNDLE_SMOKE_LANGUAGE_CODES].sort(),
    );
  });

  it("watches only providers the root layout actually mounts", () => {
    const layout = read("app/_layout.tsx");
    for (const provider of BUNDLE_SMOKE_PROVIDERS) {
      assert.ok(
        layout.includes(`<${provider}`),
        `${provider} is watched but not mounted in app/_layout.tsx`,
      );
    }
  });

  it("watches only i18n keys the translation table declares", () => {
    const source = readI18nSource();
    for (const key of BUNDLE_SMOKE_I18N_KEYS) {
      assert.ok(
        source.includes(`${key}:`),
        `${key} is watched but no longer exists — the check would fail for the wrong reason`,
      );
    }
  });
});
