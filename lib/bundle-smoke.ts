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

import {
  PRIVACY_DEFAULT_LANGUAGE,
  PRIVACY_PAGE_LANGUAGES,
} from "./privacy-page";

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
  | "untranslated_body";

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

export type PrivacyPageInput = {
  readonly target: PrivacyPageTarget;
  readonly exists: boolean;
  /** File contents, or null when it could not be read. */
  readonly text: string | null;
};

export type PrivacyPageVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: PrivacyPageFailureCode };

/**
 * Exhaustive over {@link PrivacyPageFailureCode} so a new code cannot ship
 * without a message, matching `lib/bundle-premise.ts`'s table.
 */
const PRIVACY_PAGE_MESSAGE: Record<
  PrivacyPageFailureCode,
  (target: PrivacyPageTarget) => string
> = {
  missing_file: (target) =>
    `${target.relativePath} missing — the /privacy page for "${target.code}" was not emitted. App Store review links to the English one and the translations are the GDPR Art. 12 disclosure, so a build without them is not shippable.`,
  missing_marker: (target) =>
    `${target.relativePath} does not contain ${JSON.stringify(PRIVACY_PAGE_MARKER)} — the file exists but is not a rendered privacy page.`,
  wrong_language: (target) =>
    `${target.relativePath} is not marked \`<html lang="${target.code}">\` — the wrong translation was written to this path, which a title-only check cannot see.`,
  empty_body: (target) =>
    `${target.relativePath} carries the page chrome but no ${PRIVACY_PAGE_BODY_MARKER}…> heading — the policy body rendered empty.`,
  untranslated_heading: (target) =>
    `${target.relativePath} renders the SAME <h1> as the English policy at ${PRIVACY_PAGE_RELATIVE_PATH} — the page is marked \`<html lang="${target.code}">\` but its text is English, so PRIVACY.md.${target.code} was never translated (or the English source was pasted through it).`,
  untranslated_body: (target) =>
    `${target.relativePath} has a translated heading but the SAME policy text as the English page at ${PRIVACY_PAGE_RELATIVE_PATH} — PRIVACY.md.${target.code} is a translated title over an English disclosure, which is the half of the file a reader actually needs.`,
};

/**
 * An unreadable file is reported as `missing_file` rather than as its own code:
 * from the reader's side "it is not there" and "I could not open it" have the
 * same fix, and a third message would only make the log harder to scan.
 *
 * Gate order is most-specific-last: "there is no file" explains every other
 * symptom, and "this is not a privacy page at all" explains the two content
 * checks, so each failure names the smallest thing that is wrong.
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
  return { ok: true };
}

export type PrivacyPageFailure = {
  readonly target: PrivacyPageTarget;
  readonly code: PrivacyPageFailureCode;
};

export type PrivacyPagesResult = {
  readonly ok: boolean;
  readonly failures: readonly PrivacyPageFailure[];
  readonly checked: number;
};

/** What a translated page is compared against: the English page's own prose. */
type PrivacyPageBaseline = {
  readonly heading: string | null;
  readonly body: string | null;
};

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
 * At most ONE failure is reported per page: a wholly-English translation fails
 * both comparisons, and "the heading is English" is the smaller, truer thing to
 * say about it. The body message is for the case the heading check let through.
 *
 * An empty input list is NOT ok: it is the same "checked nothing, reported
 * success" shape {@link evaluateBundleSmoke} refuses.
 */
export function evaluatePrivacyPages(
  inputs: readonly PrivacyPageInput[],
): PrivacyPagesResult {
  const english = findDefaultLanguageBaseline(inputs);
  const failures: PrivacyPageFailure[] = [];
  for (const input of inputs) {
    const verdict = evaluatePrivacyPage(input);
    if (!verdict.ok) {
      failures.push({ target: input.target, code: verdict.code });
      continue;
    }
    if (input.target.code === PRIVACY_DEFAULT_LANGUAGE) continue;
    if (input.text === null) continue;
    const heading = extractPrivacyPageHeading(input.text);
    if (english.heading !== null && heading === english.heading) {
      failures.push({ target: input.target, code: "untranslated_heading" });
      continue;
    }
    const body = extractPrivacyPageBodyText(input.text);
    if (english.body !== null && body === english.body) {
      failures.push({ target: input.target, code: "untranslated_body" });
    }
  }
  return {
    ok: inputs.length > 0 && failures.length === 0,
    failures,
    checked: inputs.length,
  };
}

export function formatPrivacyPageFailure(
  checkName: string,
  failure: PrivacyPageFailure,
): string {
  return `${checkName}: ERROR — ${PRIVACY_PAGE_MESSAGE[failure.code](failure.target)}`;
}

export function formatPrivacyPagesReport(
  checkName: string,
  result: PrivacyPagesResult,
): string {
  if (result.ok) {
    return `${checkName}: ${result.checked} privacy page(s) present and rendered.`;
  }
  if (result.checked === 0) {
    return `${checkName}: ERROR — checked 0 privacy pages; a pass over zero pages is not a pass.`;
  }
  return result.failures
    .map((failure) => formatPrivacyPageFailure(checkName, failure))
    .join("\n");
}
