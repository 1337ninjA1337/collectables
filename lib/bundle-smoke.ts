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

/** Title `renderPrivacyPage` always writes — its absence means an empty render. */
export const PRIVACY_PAGE_MARKER = "Privacy Policy";

export type PrivacyPageFailureCode = "missing_file" | "missing_marker";

export type PrivacyPageInput = {
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
const PRIVACY_PAGE_MESSAGE: Record<PrivacyPageFailureCode, string> = {
  missing_file: `${PRIVACY_PAGE_RELATIVE_PATH} missing — /privacy page not emitted. App Store review links to it, so a build without it is not shippable.`,
  missing_marker: `${PRIVACY_PAGE_RELATIVE_PATH} does not contain ${JSON.stringify(PRIVACY_PAGE_MARKER)} — the page was emitted but rendered empty.`,
};

/**
 * An unreadable file is reported as `missing_file` rather than as its own code:
 * from the reader's side "it is not there" and "I could not open it" have the
 * same fix, and a third message would only make the log harder to scan.
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
  return { ok: true };
}

export function formatPrivacyPageFailure(
  checkName: string,
  code: PrivacyPageFailureCode,
): string {
  return `${checkName}: ERROR — ${PRIVACY_PAGE_MESSAGE[code]}`;
}
