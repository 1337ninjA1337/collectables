/**
 * Post-build smoke check over the exported web bundle and the static
 * `/privacy` page (pure logic — the filesystem half lives in
 * `scripts/check-bundle-smoke.ts`).
 *
 * Both checks used to be inline `run: |` shell in ci.yml: a `ls … | head -1`
 * plus a `grep` loop for the bundle, and a `[ ! -f … ]` plus one `grep` for the
 * privacy page. They were correct, but they were the last two post-build steps
 * hand-rolling their own "is there anything here?" logic, which cost three
 * things:
 *
 *   1. No freshness. `assertBundlePremise` (see `lib/bundle-premise.ts`) knows
 *      that a `dist/` older than the source tree is a bundle that predates the
 *      change being checked; the shell greps happily reported a passing smoke
 *      test over one. That is the same vacuous-green shape the three npm
 *      guards were fixed for, left live in the two steps that were not npm
 *      guards.
 *   2. Only the FIRST chunk was searched (`head -1`). The export splits into
 *      several `*.js` chunks and nothing pins which one a given key lands in,
 *      so a Metro chunking change could move `marketplaceTitle` into chunk two
 *      and fail a check whose premise ("the bundle contains this key") was
 *      still perfectly true. Searching every chunk asks the question the check
 *      actually means.
 *   3. Nothing was testable. The watched i18n keys, provider names and language
 *      codes lived in YAML, so no suite could assert the language list still
 *      matches the languages the app ships.
 *
 * The tokens are deliberately a flat list with a `kind`, not three arrays: the
 * report groups by kind, and a single list means one traversal and one place to
 * add a token.
 */

import { PRIVACY_BODY_BASELINE_WORDS } from "./privacy-body-baselines";
import {
  PRIVACY_DEFAULT_LANGUAGE,
  PRIVACY_PAGE_LANGUAGES,
} from "./privacy-languages";

export {
  PRIVACY_BODY_BASELINES,
  PRIVACY_BODY_BASELINE_WORDS,
  privacyPolicySourcePath,
  type PrivacyBodyBaseline,
} from "./privacy-body-baselines";

export type BundleSmokeTokenKind = "i18n-key" | "provider" | "language";

export type BundleSmokeToken = {
  readonly kind: BundleSmokeTokenKind;
  /** Literal substring searched for in the bundle text. */
  readonly token: string;
};

/**
 * The six `AppLanguage` codes, quoted exactly as they appear in the compiled
 * translation table. Declared here rather than imported from
 * `lib/i18n-context.tsx`, which pulls react-native and so cannot be loaded by a
 * node CLI or by `tsx --test`; `__tests__/bundle-smoke.test.ts` parses the
 * `AppLanguage` union out of that file and fails if the two ever disagree.
 */
export const BUNDLE_SMOKE_LANGUAGE_CODES = [
  "ru",
  "en",
  "be",
  "pl",
  "de",
  "es",
] as const;

/**
 * i18n keys spread across the surfaces most likely to break silently: the
 * marketplace (newest provider), the two creation flows and auth. A missing key
 * here means a provider was dropped from the tree or a key was renamed on one
 * side only.
 */
export const BUNDLE_SMOKE_I18N_KEYS = [
  "marketplaceListOnMarketplace",
  "marketplaceTitle",
  "addItem",
  "createCollection",
  "signOut",
] as const;

/** Every context provider `app/_layout.tsx` mounts around the router. */
export const BUNDLE_SMOKE_PROVIDERS = [
  "MarketplaceProvider",
  "CollectionsProvider",
  "SocialProvider",
  "AuthProvider",
] as const;

export const BUNDLE_SMOKE_TOKENS: readonly BundleSmokeToken[] = [
  ...BUNDLE_SMOKE_I18N_KEYS.map(
    (token): BundleSmokeToken => ({ kind: "i18n-key", token }),
  ),
  ...BUNDLE_SMOKE_PROVIDERS.map(
    (token): BundleSmokeToken => ({ kind: "provider", token }),
  ),
  // Quoted, matching the shell check this replaced: an unquoted "de" matches
  // half the minified identifiers in any bundle and would pass no matter what.
  ...BUNDLE_SMOKE_LANGUAGE_CODES.map(
    (code): BundleSmokeToken => ({ kind: "language", token: `"${code}"` }),
  ),
];

export type BundleSmokeResult = {
  readonly ok: boolean;
  readonly missing: readonly BundleSmokeToken[];
  /** How many chunks were searched — echoed in the report so a 1-chunk run is visible. */
  readonly chunkCount: number;
};

const TOKEN_KIND_LABEL: Record<BundleSmokeTokenKind, string> = {
  "i18n-key": "i18n key",
  provider: "provider",
  language: "i18n language code",
};

/**
 * A token counts as present when ANY chunk contains it — the bundle is the
 * union of its chunks, and which chunk a string lands in is a Metro decision no
 * check should depend on.
 *
 * Callers pass the chunk texts they read; an empty list is NOT special-cased
 * here (it would report every token missing, which is true) because the
 * premise assertion upstream already refuses to run over zero chunks with a
 * message that names the real cause.
 */
export function evaluateBundleSmoke(
  chunkTexts: readonly string[],
  tokens: readonly BundleSmokeToken[] = BUNDLE_SMOKE_TOKENS,
): BundleSmokeResult {
  const missing = tokens.filter(
    (entry) => !chunkTexts.some((text) => text.includes(entry.token)),
  );
  return { ok: missing.length === 0, missing, chunkCount: chunkTexts.length };
}

export function formatBundleSmokeReport(
  checkName: string,
  result: BundleSmokeResult,
): string {
  if (result.ok) {
    return `${checkName}: bundle smoke passed — ${BUNDLE_SMOKE_TOKENS.length} token(s) found across ${result.chunkCount} chunk(s).`;
  }
  const lines = result.missing.map(
    (entry) =>
      `${checkName}: ERROR — expected ${TOKEN_KIND_LABEL[entry.kind]} ${JSON.stringify(entry.token)} not found in any of the ${result.chunkCount} bundle chunk(s).`,
  );
  return lines.join("\n");
}

/** Emitted by `scripts/build-spa-fallback.ts` from the tracked `PRIVACY.md`. */
export const PRIVACY_PAGE_RELATIVE_PATH = "dist/privacy/index.html";

/** Title `renderPrivacyPage` always writes, in every language. */
export const PRIVACY_PAGE_MARKER = "Privacy Policy";

/**
 * `renderMarkdownBody` emits the source file's leading `# …` as an `<h1>`, and
 * the page chrome (language picker, style block) contains no heading — so this
 * is the cheapest "the markdown actually rendered" signal.
 *
 * It is what {@link PRIVACY_PAGE_MARKER} alone cannot prove: the title lives in
 * the template, so `renderPrivacyPage("")` produces a page carrying the marker
 * and no policy at all. A check that passed on that would be the vacuous-green
 * shape this whole guard exists to close.
 */
export const PRIVACY_PAGE_BODY_MARKER = "<h1";

export type PrivacyPageTarget = {
  /** BCP-47-ish language code the page was rendered for. */
  readonly code: string;
  readonly relativePath: string;
};

/**
 * Every privacy page the build emits: the canonical English policy at
 * `/privacy/` plus one translated Sentry-disclosure page per non-English
 * language at `/privacy/<code>/`.
 *
 * DERIVED from `PRIVACY_PAGE_LANGUAGES` rather than listed, so a seventh
 * language is covered the moment `lib/privacy-page.ts` learns about it. That
 * module is node-pure (the build scripts import it), so unlike
 * `lib/i18n-context.tsx` it can simply be imported here.
 *
 * The five translated pages are the GDPR Art. 12 disclosure surface and were
 * previously unchecked by anything — the shell version looked at the English
 * page alone, while `build-spa-fallback.ts` emits all six.
 */
export const PRIVACY_PAGE_TARGETS: readonly PrivacyPageTarget[] =
  PRIVACY_PAGE_LANGUAGES.map(({ code }) => ({
    code,
    relativePath:
      code === PRIVACY_DEFAULT_LANGUAGE
        ? PRIVACY_PAGE_RELATIVE_PATH
        : `dist/privacy/${code}/index.html`,
  }));

export type PrivacyPageFailureCode =
  | "missing_file"
  | "missing_marker"
  | "wrong_language"
  | "empty_body"
  | "untranslated_heading"
  | "untranslated_body"
  | "near_english_body"
  | "body_too_short"
  | "missing_baseline"
  | "body_size_drift";

/**
 * Markup out, comparable prose in: tags stripped, whitespace collapsed, empty
 * result reported as null rather than `""`.
 *
 * Text, not markup, because `renderInline` runs over the policy: a `**bold**`
 * word in one source file and not in another would make two identical
 * sentences compare unequal for a reason no reader cares about. Null rather
 * than `""` because two pages that each extracted to nothing must not count as
 * copies of each other.
 */
function normalizeMarkupText(html: string): string | null {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? null : text;
}

/**
 * The rendered `<h1>` text, or null when the page carries no closed heading.
 */
export function extractPrivacyPageHeading(text: string): string | null {
  const match = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return match ? normalizeMarkupText(match[1]) : null;
}

/**
 * Everything the policy says AFTER its heading, as text.
 *
 * Cut at the first `</h1>` rather than assembled from `<p>`/`<li>`/`<h2>`
 * selectors: `renderPrivacyPage` emits head → style → language picker → body,
 * so the heading's close tag is the last piece of page chrome, and taking the
 * remainder means the check does not have to be updated every time the
 * markdown converter learns a new block type. The closing `</body></html>`
 * contributes no text.
 */
export function extractPrivacyPageBodyText(text: string): string | null {
  const end = text.indexOf("</h1>");
  if (end === -1) return null;
  return normalizeMarkupText(text.slice(end + "</h1>".length));
}

/**
 * Above this share of the shorter body's words, two policy bodies are the same
 * document rather than two documents that happen to overlap.
 *
 * 0.9 is not a hedge, it is a wide margin measured against the shipped files:
 * the six REAL rendered bodies sit between 0.157 and 0.280 against each other
 * (they share proper nouns, URLs and the effective date and nothing else),
 * while an exact copy is 1.0 and English-with-a-paragraph-appended is also 1.0
 * — every word of the shorter document is accounted for. There is nothing in
 * the 0.3–0.9 band today, and a translation that drifted into it would be a
 * file worth looking at anyway. Pinned by a test that recomputes the real
 * ratios, so shipping a translation close to the line fails here.
 */
export const PRIVACY_BODY_SIMILARITY_THRESHOLD = 0.9;

/**
 * The one word floor, used for two things on purpose.
 *
 * {@link privacyBodySimilarity} refuses to measure below it, because a ratio
 * over a handful of words is noise: two unrelated short notices that share
 * `Collectables`, `Sentry`, a URL and a date score 1.0 without being related at
 * all, and the words a policy cannot avoid repeating are exactly the ones that
 * survive translation.
 *
 * {@link evaluatePrivacyPage} FAILS below it, which is what makes the first
 * half safe. A refusal that only skipped would be a gate that turns itself off
 * on the pages least able to afford it: a `PRIVACY.md` truncated under the
 * floor takes the near-copy comparison down for all five translations at once,
 * silently, and the run still prints `6 privacy page(s) present and rendered`.
 * Sharing the constant makes "no page that passes is too short to compare" an
 * invariant rather than a hope — every page reaching the ratio has cleared the
 * ratio's own floor, and a test asserts exactly that.
 *
 * 40 sits an order of magnitude below the shortest shipped body (169 words) and
 * far above the range where proper nouns dominate. It is a floor on nonsense,
 * not a judgement about how long a disclosure should be — the "is this
 * translation suspiciously shorter than the English one" question is a
 * different check with a different number.
 */
export const PRIVACY_BODY_SIMILARITY_MIN_WORDS = 40;

/**
 * Comparable words: Unicode letters and digits, lowercased, punctuation and
 * markup-shaped debris dropped.
 *
 * `\p{L}` rather than `\w` because four of the six languages are not ASCII and
 * `ru`/`be` are not even Latin — `\w` would reduce a Cyrillic body to its
 * digits and score every pair of them 1.0 on the numbers alone.
 */
export function privacyBodyWords(text: string): readonly string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * How much of the SHORTER body is accounted for by the longer one, 0..1, or
 * null when either side is too short for the ratio to mean anything (see
 * {@link PRIVACY_BODY_SIMILARITY_MIN_WORDS}).
 *
 * Two decisions:
 *
 *   1. Over the SHORTER body, not over the union. The failure being hunted is
 *      "this page is the English document", and the cheapest way to dress an
 *      English document up as a translation is to add to it — a German
 *      paragraph appended to the English disclosure changes every symmetric
 *      measure and changes this one not at all, because every English word is
 *      still there. It also makes a TRUNCATED English body score 1.0, which is
 *      right: half the English policy is still the English policy.
 *   2. Multiset, not set. Counting `min(count_a, count_b)` per word means a
 *      body that repeats `data` forty times cannot borrow forty matches from a
 *      document that says it once. Set intersection scores that pair far higher
 *      than the documents deserve, and short bodies are where it happens.
 */
export function privacyBodySimilarity(a: string, b: string): number | null {
  const wordsA = privacyBodyWords(a);
  const wordsB = privacyBodyWords(b);
  if (
    wordsA.length < PRIVACY_BODY_SIMILARITY_MIN_WORDS ||
    wordsB.length < PRIVACY_BODY_SIMILARITY_MIN_WORDS
  ) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const word of wordsA) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of wordsB) {
    const left = counts.get(word) ?? 0;
    if (left > 0) {
      shared += 1;
      counts.set(word, left - 1);
    }
  }
  return shared / Math.min(wordsA.length, wordsB.length);
}

/*
 * The word count each policy file is EXPECTED to render to lives in
 * `lib/privacy-body-baselines.ts` and is re-exported at the top of this file.
 *
 * The floor above is a floor on nonsense: it catches a page truncated to
 * almost nothing and is silent on a page that lost two thirds of itself. The
 * canonical English policy at 1171 words cut to 400 by a bad merge clears the
 * 40-word floor by an order of magnitude, differs from every translation, has a
 * heading and a body, and passes every other gate — and then every content
 * check downstream runs against a document that lost most of itself, quietly,
 * because the translations still look nothing like it.
 *
 * A tracked number per file is the only thing that notices, and the reason it
 * has to be tracked rather than derived is that there is nothing to derive it
 * from: the policy is the source of truth about itself. Updating that table is
 * therefore part of amending a policy, not an obstacle to it — the failure
 * message quotes the measured count so the update is a copy-paste, and the
 * commit that changes a number there is the commit that says a disclosure
 * changed size on purpose. Which is also why the table moved out: each entry
 * now carries the DATE and REASON of its current value, and a guard compares
 * the table against its own previous revision, so "paste the measured count in
 * and move on" — the resolution that turns this gate into a rubber stamp — is
 * itself a build failure. See that module's header.
 */

/**
 * How far a rendered body may sit from its baseline before the build fails,
 * as a share of the baseline.
 *
 * Symmetric on purpose, though the two directions catch different things.
 * SHRINKING is the failure this exists for — a dropped section, a truncated
 * merge, a half-finished re-translation. GROWTH is not a bug and is checked
 * anyway, because the cheapest way for a translation to grow 40% is for
 * someone to paste the English disclosure into it, and because a baseline that
 * only ever constrains one direction quietly stops describing the file.
 *
 * 0.25 is loose enough to absorb ordinary wording work — the shortest file is
 * 169 words, so it takes ~42 words, roughly two paragraphs, to trip — and
 * tight enough that no single section of any of the six survives being
 * dropped. A legitimate amendment past the band is expected to update
 * {@link PRIVACY_BODY_BASELINE_WORDS}; that is the mechanism, not a side
 * effect of it.
 */
export const PRIVACY_BODY_BASELINE_TOLERANCE = 0.25;

/** Inclusive word band a page of the given language must land in. */
export function privacyBodyBaselineBand(baseline: number): {
  readonly min: number;
  readonly max: number;
} {
  return {
    min: baseline * (1 - PRIVACY_BODY_BASELINE_TOLERANCE),
    max: baseline * (1 + PRIVACY_BODY_BASELINE_TOLERANCE),
  };
}

export type PrivacyPageInput = {
  readonly target: PrivacyPageTarget;
  readonly exists: boolean;
  /** File contents, or null when it could not be read. */
  readonly text: string | null;
};

export type PrivacyPageVerdict =
  | {
      readonly ok: true;
      /**
       * Words in the rendered body — measured to apply the floor, so returning
       * it costs nothing and is the only number this check knows about a page
       * that passed. See {@link PrivacyPagesResult.wordCounts}.
       */
      readonly wordCount: number;
    }
  | {
      readonly ok: false;
      readonly code: PrivacyPageFailureCode;
      /** Carried into the message; see {@link PrivacyPageFailure.detail}. */
      readonly detail?: string;
    };

/**
 * Exhaustive over {@link PrivacyPageFailureCode} so a new code cannot ship
 * without a message, matching `lib/bundle-premise.ts`'s table.
 *
 * Each entry takes the whole failure rather than just its target, so a code
 * that measured something can quote the measurement. Only
 * `near_english_body` does today: "97% of its words" and "91% of its words"
 * are the difference between a copy with edits and a page worth a second look,
 * and a reader deciding which one they have should not have to re-run the
 * check by hand.
 */
const PRIVACY_PAGE_MESSAGE: Record<
  PrivacyPageFailureCode,
  (target: PrivacyPageTarget, detail: string | undefined) => string
> = {
  missing_file: (target) =>
    `${target.relativePath} missing — the /privacy page for "${target.code}" was not emitted. App Store review links to the English one and the translations are the GDPR Art. 12 disclosure, so a build without them is not shippable.`,
  missing_marker: (target) =>
    `${target.relativePath} does not contain ${JSON.stringify(PRIVACY_PAGE_MARKER)} — the file exists but is not a rendered privacy page.`,
  wrong_language: (target) =>
    `${target.relativePath} is not marked \`<html lang="${target.code}">\` — the wrong translation was written to this path, which a title-only check cannot see.`,
  empty_body: (target) =>
    `${target.relativePath} carries the page chrome but no ${PRIVACY_PAGE_BODY_MARKER}…> heading — the policy body rendered empty.`,
  body_too_short: (target, detail) =>
    `${target.relativePath} renders a heading over ${detail ?? "almost no"} of policy text, under the ${PRIVACY_BODY_SIMILARITY_MIN_WORDS}-word floor — the shortest shipped translation is 169 words, so this is a truncated or half-written file. It also takes the near-copy comparison offline for this page, which is the second reason it is a failure and not a warning.`,
  missing_baseline: (target) =>
    `${target.relativePath} has no entry in PRIVACY_BODY_BASELINE_WORDS for "${target.code}" — a language was added to PRIVACY_PAGE_LANGUAGES without recording the size its policy renders to, and without one this page is exempt from the drift check every other page is held to. Measure it and add it (lib/bundle-smoke.ts).`,
  body_size_drift: (target, detail) =>
    `${target.relativePath} renders ${detail ?? "a body of an unexpected size"} — outside the ±${Math.round(PRIVACY_BODY_BASELINE_TOLERANCE * 100)}% band around its recorded baseline. Shrinking is the case this guard exists for: a section dropped in a merge clears the ${PRIVACY_BODY_SIMILARITY_MIN_WORDS}-word floor easily and still leaves the disclosure incomplete. If the policy was amended on purpose, update PRIVACY_BODY_BASELINE_WORDS["${target.code}"] in lib/bundle-smoke.ts to the measured count.`,
  untranslated_heading: (target) =>
    `${target.relativePath} renders the SAME <h1> as the English policy at ${PRIVACY_PAGE_RELATIVE_PATH} — the page is marked \`<html lang="${target.code}">\` but its text is English, so PRIVACY.md.${target.code} was never translated (or the English source was pasted through it).`,
  untranslated_body: (target) =>
    `${target.relativePath} has a translated heading but the SAME policy text as the English page at ${PRIVACY_PAGE_RELATIVE_PATH} — PRIVACY.md.${target.code} is a translated title over an English disclosure, which is the half of the file a reader actually needs.`,
  near_english_body: (target, detail) =>
    `${target.relativePath} has a translated heading but ${detail ?? "nearly all"} of its policy text is the English page at ${PRIVACY_PAGE_RELATIVE_PATH} — PRIVACY.md.${target.code} is the English disclosure with edits, not a translation. The shipped translations share ~20-30% of their words with English (proper nouns, URLs, the effective date); anything over ${Math.round(PRIVACY_BODY_SIMILARITY_THRESHOLD * 100)}% is the same document.`,
};

/**
 * An unreadable file is reported as `missing_file` rather than as its own code:
 * from the reader's side "it is not there" and "I could not open it" have the
 * same fix, and a third message would only make the log harder to scan.
 *
 * Gate order is most-specific-last: "there is no file" explains every other
 * symptom, and "this is not a privacy page at all" explains the content
 * checks, so each failure names the smallest thing that is wrong. The word
 * floor sits at the end for the same reason — a page with no heading has no
 * body worth counting, and `empty_body` is the truer thing to say about it.
 */
export function evaluatePrivacyPage(
  input: PrivacyPageInput,
): PrivacyPageVerdict {
  if (!input.exists || input.text === null) {
    return { ok: false, code: "missing_file" };
  }
  if (!input.text.includes(PRIVACY_PAGE_MARKER)) {
    return { ok: false, code: "missing_marker" };
  }
  // `<html lang=…>`, not a bare `lang="de"`: the language picker renders an
  // `<a lang="de" hreflang="de">` link on EVERY page, so the loose form is
  // present in all six and the check would never fire. Caught by running it —
  // the first draft passed a deliberately mis-copied page.
  if (!input.text.includes(`<html lang="${input.target.code}">`)) {
    return { ok: false, code: "wrong_language" };
  }
  if (!input.text.includes(PRIVACY_PAGE_BODY_MARKER)) {
    return { ok: false, code: "empty_body" };
  }
  // `empty_body` proves a heading rendered, which is all `<h1` can prove — the
  // body below it is what the marker was named for and never checked. A page
  // whose policy text is a dozen words is broken on its own terms AND is the
  // one input that can make the near-copy ratio go quiet, so it fails here
  // rather than being tolerated and skipped downstream.
  const wordCount = privacyBodyWords(
    extractPrivacyPageBodyText(input.text) ?? "",
  ).length;
  if (wordCount < PRIVACY_BODY_SIMILARITY_MIN_WORDS) {
    return {
      ok: false,
      code: "body_too_short",
      detail: `${wordCount} word(s)`,
    };
  }
  return { ok: true, wordCount };
}

export type PrivacyPageFailure = {
  readonly target: PrivacyPageTarget;
  readonly code: PrivacyPageFailureCode;
  /**
   * What the check measured, when it measured anything — spliced into the
   * message. Left OFF (not set to undefined) by codes that measure nothing, so
   * a `deepEqual` against `{ target, code }` still holds for them.
   */
  readonly detail?: string;
};

/** One page's measured body size, kept so the report can quote it. */
export type PrivacyPageWordCount = {
  readonly code: string;
  readonly words: number;
};

export type PrivacyPagesResult = {
  readonly ok: boolean;
  readonly failures: readonly PrivacyPageFailure[];
  readonly checked: number;
  /**
   * Body word count per page that cleared the per-page gates, in input order.
   *
   * The floor already counts every page's words and used to throw the number
   * away the moment it passed, which made a translation SHRINKING invisible
   * until the commit that pushed it under
   * {@link PRIVACY_BODY_SIMILARITY_MIN_WORDS} — at which point the build goes
   * red with no history to read. Reporting the range on success turns that into
   * a number that moves in the log commit by commit.
   *
   * Pages that FAILED contribute nothing: a page whose body did not render has
   * no size worth quoting, and `body_too_short` already carries its own count
   * into its message. So this is non-empty exactly when the run passed, which a
   * test pins.
   */
  readonly wordCounts: readonly PrivacyPageWordCount[];
};

/** What a translated page is compared against: the English page's own prose. */
type PrivacyPageBaseline = {
  readonly heading: string | null;
  readonly body: string | null;
};

/**
 * The cross-page half: is this translated page actually a translation, or is
 * it the English document wearing a language attribute?
 *
 * Null for the English page itself (it is the baseline, not a candidate), for
 * a page whose baseline half did not extract, and for a page that is genuinely
 * its own document.
 *
 * At most ONE failure comes back, in most-specific-first order (heading →
 * identical body → near-identical body): a wholly-English translation trips
 * all three, and "the heading is English" is the smallest, truest thing to say
 * about it. Each later check is for the case the one before it let through.
 */
function evaluatePrivacyPageProse(
  input: PrivacyPageInput,
  english: PrivacyPageBaseline,
): PrivacyPageFailure | null {
  if (input.target.code === PRIVACY_DEFAULT_LANGUAGE) return null;
  if (input.text === null) return null;
  const heading = extractPrivacyPageHeading(input.text);
  if (english.heading !== null && heading === english.heading) {
    return { target: input.target, code: "untranslated_heading" };
  }
  const body = extractPrivacyPageBodyText(input.text);
  // Both are non-null for anything that got here — a page with no extractable
  // body fails `empty_body` or `body_too_short` upstream, and the baseline is
  // only taken from an English page that passed those same gates. Kept as a
  // guard rather than an assertion because the alternative is a crash in a
  // build guard, and "one comparison did not run" is the better failure.
  if (english.body === null || body === null) return null;
  if (body === english.body) {
    return { target: input.target, code: "untranslated_body" };
  }
  const similarity = privacyBodySimilarity(body, english.body);
  if (similarity !== null && similarity >= PRIVACY_BODY_SIMILARITY_THRESHOLD) {
    return {
      target: input.target,
      code: "near_english_body",
      detail: `${Math.round(similarity * 100)}%`,
    };
  }
  return null;
}

/**
 * The size half of the checks a single page cannot decide for itself — not
 * because the measurement is cross-page (it is not; the count is the page's
 * own) but because the ORDER is. `body_size_drift` and the prose comparisons
 * both fire on the same input — `PRIVACY.md.de` holding the 1171-word English
 * disclosure is 593% of its recorded size AND a copy of the English page — and
 * "this is the English document" is the smaller, truer, more actionable thing
 * to say. So the drift check runs last, after the prose gates, which is only
 * expressible where those gates live.
 *
 * Returns null when the page is the size it should be.
 */
function evaluatePrivacyPageSize(
  target: PrivacyPageTarget,
  wordCount: number,
  baselines: Readonly<Record<string, number>>,
): PrivacyPageFailure | null {
  const baseline = baselines[target.code];
  // A language with no recorded baseline is a FAILURE, not a skip: the
  // alternative is that adding a seventh language silently exempts its policy
  // from the one check that would notice it shrinking.
  if (baseline === undefined) {
    return { target, code: "missing_baseline" };
  }
  const band = privacyBodyBaselineBand(baseline);
  if (wordCount >= band.min && wordCount <= band.max) return null;
  const drift = Math.round(((wordCount - baseline) / baseline) * 100);
  return {
    target,
    code: "body_size_drift",
    detail: `${wordCount} word(s) against a baseline of ${baseline} (${drift > 0 ? "+" : ""}${drift}%)`,
  };
}

/**
 * The English page's heading and body text, taken only from a page that passed
 * its own gates — comparing against prose pulled out of a broken English page
 * would report six failures for one cause.
 *
 * Both halves are null when the English page is absent from the input or
 * broken, and either half is null on its own when that piece did not extract;
 * a null half means its comparison does not run. That is deliberate: every one
 * of those states is already reported by the per-page gates (or was never asked
 * about), and inventing a comparison baseline out of one of them turns one
 * clear failure into five confusing ones.
 */
function findDefaultLanguageBaseline(
  inputs: readonly PrivacyPageInput[],
): PrivacyPageBaseline {
  const none: PrivacyPageBaseline = { heading: null, body: null };
  const english = inputs.find(
    (input) => input.target.code === PRIVACY_DEFAULT_LANGUAGE,
  );
  if (!english || english.text === null) return none;
  if (!evaluatePrivacyPage(english).ok) return none;
  return {
    heading: extractPrivacyPageHeading(english.text),
    body: extractPrivacyPageBodyText(english.text),
  };
}

/**
 * Every page is evaluated — a fail-fast loop would report the English page and
 * hide the five translations behind it, costing a CI run per language.
 *
 * The prose comparisons are CROSS-page and so live here rather than in
 * {@link evaluatePrivacyPage}: they are the one thing a single page cannot know
 * about itself. `<html lang="de">` comes from the renderer's argument, not from
 * the content, so `PRIVACY.md.de` holding the English text satisfies every
 * per-page gate — file present, title present, right lang attribute, body
 * rendered — and ships an untranslated GDPR Art. 12 disclosure.
 *
 * Heading and body are compared SEPARATELY, and the body is the one that
 * matters. A heading-only check reads a translated title as a translated page,
 * which is exactly the state a half-finished translation is left in: someone
 * renders `# Datenschutzerklärung` over the English disclosure and the guard
 * calls it done. Comparing the two independently means the report names which
 * half was not translated, and the body — the part a reader is actually owed
 * under GDPR Art. 12 — cannot pass on the strength of its title.
 *
 * The body is compared twice, exactly and then by ratio, because an equality
 * test is one edit away from useless: `untranslated_body` fires only on a
 * normalised byte match, so the English disclosure with a single German
 * sentence appended — or one word changed, or a stray character — walks through
 * it. {@link privacyBodySimilarity} turns "not literally identical" into
 * "actually a different document", which is what the check meant all along.
 *
 * At most ONE failure is reported per page, in most-specific-first order
 * (heading → identical body → near-identical body → size): a wholly-English
 * translation fails all four, and "the heading is English" is the smallest,
 * truest thing to say about it. Each later message is for the case the one
 * before it let through, which is also why `body_size_drift` sits at the end:
 * `PRIVACY.md.de` holding the English disclosure is both a copy and 593% of
 * its recorded size, and only one of those two sentences tells anyone what to
 * do.
 *
 * An empty input list is NOT ok: it is the same "checked nothing, reported
 * success" shape {@link evaluateBundleSmoke} refuses.
 */
export function evaluatePrivacyPages(
  inputs: readonly PrivacyPageInput[],
  baselines: Readonly<Record<string, number>> = PRIVACY_BODY_BASELINE_WORDS,
): PrivacyPagesResult {
  const english = findDefaultLanguageBaseline(inputs);
  const failures: PrivacyPageFailure[] = [];
  const wordCounts: PrivacyPageWordCount[] = [];
  for (const input of inputs) {
    const verdict = evaluatePrivacyPage(input);
    if (!verdict.ok) {
      failures.push({
        target: input.target,
        code: verdict.code,
        // Spread rather than always-set, so codes that measured nothing keep
        // the two-key shape their `deepEqual` pins expect.
        ...(verdict.detail === undefined ? {} : { detail: verdict.detail }),
      });
      continue;
    }
    // Recorded before the cross-page comparisons: the count is a property of
    // the page's own body, and a page that turns out to be a copy of the
    // English one still has a size the reader may want to see next to the
    // failure.
    wordCounts.push({ code: input.target.code, words: verdict.wordCount });
    // Prose first, size last. The English page skips the prose half (it is the
    // baseline) and is size-checked like everything else — it is the canonical
    // document, so it is the one whose shrinking matters most.
    const failure =
      evaluatePrivacyPageProse(input, english) ??
      evaluatePrivacyPageSize(input.target, verdict.wordCount, baselines);
    if (failure) failures.push(failure);
  }
  return {
    ok: inputs.length > 0 && failures.length === 0,
    failures,
    checked: inputs.length,
    wordCounts,
  };
}

/**
 * `169-1171 words`, or `169 words` when every page measured the same — the
 * range is the point, and `169-169` reads like a bug.
 *
 * Returns null for an empty list so the caller prints the plain verdict rather
 * than an empty parenthetical; that state is unreachable on a passing run (see
 * {@link PrivacyPagesResult.wordCounts}) and is handled because a format helper
 * crashing a build guard is the worse failure.
 */
export function formatPrivacyPageWordCounts(
  counts: readonly PrivacyPageWordCount[],
): string | null {
  if (counts.length === 0) return null;
  const words = counts.map((entry) => entry.words);
  const min = Math.min(...words);
  const max = Math.max(...words);
  return min === max ? `${min} words` : `${min}-${max} words`;
}

export function formatPrivacyPageFailure(
  checkName: string,
  failure: PrivacyPageFailure,
): string {
  return `${checkName}: ERROR — ${PRIVACY_PAGE_MESSAGE[failure.code](failure.target, failure.detail)}`;
}

export function formatPrivacyPagesReport(
  checkName: string,
  result: PrivacyPagesResult,
): string {
  if (result.ok) {
    const range = formatPrivacyPageWordCounts(result.wordCounts);
    return `${checkName}: ${result.checked} privacy page(s) present and rendered${range === null ? "" : ` (${range})`}.`;
  }
  if (result.checked === 0) {
    return `${checkName}: ERROR — checked 0 privacy pages; a pass over zero pages is not a pass.`;
  }
  return result.failures
    .map((failure) => formatPrivacyPageFailure(checkName, failure))
    .join("\n");
}
