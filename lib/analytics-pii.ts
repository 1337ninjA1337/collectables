/**
 * Telemetry PII guard — single source of truth for which property-key shapes
 * are forbidden in analytics events and crash breadcrumbs (SEC-13).
 *
 * The app's telemetry is *taxonomy-first*: `lib/analytics-events.ts` declares a
 * closed `props` allow-list per event, and every `trackEvent` call site may
 * only pass those keys (enforced by `__tests__/analytics-pii.test.ts`). This
 * module is the complementary *deny* rule — it forbids the taxonomy itself from
 * ever declaring a free-text / personally-identifying property key (e.g. an
 * item `name`, a chat `message`, a user `email`), so user-authored strings can
 * never reach PostHog / Sentry under any key.
 *
 * Pure on purpose: imports nothing, so the non-RN node test runner and any
 * schema-doc tooling can consume it without a Metro/react-native shim.
 */

/**
 * Lower-cased word tokens that mark a property key as carrying free text or
 * PII. A key is rejected if ANY of its camelCase / snake_case tokens appears
 * here — so `itemName`, `display_name`, `chatMessage`, `userEmail` are all
 * caught while ID/enum/boolean keys (`collectionId`, `mode`, `hasPhoto`) pass.
 *
 * Keep this list conservative-but-broad: a false positive only forces a
 * telemetry author to pick a non-PII key, while a false negative leaks user
 * data into a third-party processor.
 */
export const PII_PROP_TOKENS: readonly string[] = Object.freeze([
  // names / identities (free text)
  "name",
  "username",
  "handle",
  "nickname",
  "firstname",
  "lastname",
  "fullname",
  // contact details
  "email",
  "mail",
  "phone",
  "tel",
  "address",
  "street",
  "city",
  "zip",
  "postal",
  // free-text bodies the user authors
  "bio",
  "title",
  "description",
  "desc",
  "message",
  "msg",
  "text",
  "body",
  "content",
  "note",
  "comment",
  "caption",
  "query",
  "search",
  "keyword",
  // secrets / credentials
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "credential",
  // precise geo / device fingerprints
  "location",
  "geo",
  "latitude",
  "longitude",
  "coords",
  "ip",
  "useragent",
  // media the user uploaded (URLs can embed names / EXIF-derived data)
  "avatar",
]);

const PII_TOKEN_SET = new Set(PII_PROP_TOKENS);

/**
 * Splits a property key into lower-cased word tokens across camelCase,
 * PascalCase, snake_case, kebab-case and digit boundaries.
 *
 *   "previousLanguage" -> ["previous", "language"]
 *   "display_name"     -> ["display", "name"]
 *   "targetUserId"     -> ["target", "user", "id"]
 */
export function tokenizePropKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

/**
 * True when a property key carries (or strongly implies) free text / PII and
 * therefore must never be sent to a telemetry processor.
 */
export function isPiiPropKey(key: string): boolean {
  return tokenizePropKey(key).some((token) => PII_TOKEN_SET.has(token));
}

/**
 * Returns the subset of `keys` that the PII rule rejects (empty = all clean).
 */
export function findPiiPropKeys(keys: Iterable<string>): string[] {
  const flagged: string[] = [];
  for (const key of keys) {
    if (isPiiPropKey(key)) flagged.push(key);
  }
  return flagged;
}
