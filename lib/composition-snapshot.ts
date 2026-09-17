/**
 * What the bundle was made of, the last time anybody measured.
 *
 * `lib/budget-snapshot.ts` records the bundle's SIZE at each budget move, and
 * five raises were argued from that number and a date because it was the only
 * thing anybody could measure. `npm run bundle:composition` can now say what
 * the bundle is made of; this is the baseline that turns that into a sentence
 * about what CHANGED — "the bundle grew 6 KiB, of which 4 is `lib/`" is an
 * argument, and "the bundle grew 6 KiB" is a fact with no owner.
 *
 * **Deliberately NOT a field on `BUDGET_SNAPSHOT`.** That module holds a pair
 * that must move together, and its whole reason for existing is that half of a
 * pair gets forgotten. This is a third thing with a different cadence: it can
 * only be re-taken from a SOURCEMAPPED build (`npm run build:sourcemaps`),
 * which no gate produces and CI never runs, so binding it to the budget would
 * mean either a raise that cannot be argued without a special build or a field
 * that is silently stale. It carries its own date and its own total, and the
 * drift line says which measurement it is speaking from.
 *
 * **Re-taking it is a copy, not a transcription**:
 *
 * ```
 * npm run build:sourcemaps
 * npm run bundle:composition -- --snapshot
 * ```
 *
 * prints exactly the three fields below. Replace them; do not hand-edit one
 * number, because a baseline where one bucket is from today and the rest are
 * from a fortnight ago reports drift that never happened.
 */

import type { CompositionBaseline } from "@/lib/bundle-composition";

// `BASELINE_BUCKET_FLOOR_BYTES` in that module is the floor the rows below
// stop at, and the same constant is what stops the unrecorded tail reading as
// an arrival on the next run — one number, so the two halves cannot disagree.

/**
 * Re-taken on 2026-09-17, after `output.ascii_only` was turned off, from a
 * `--source-maps` export of the tree `check-bundle-size` measured at 3630.2
 * KiB.
 *
 * TWO ROWS SHRANK WITH NO CODE REMOVED: `lib/` from 554,338 to 442,000 bytes
 * and `data/` from 8,725 to 5,603 — the two buckets that hold Cyrillic, the
 * copy and the seed data. (`components/` is up 4 KiB, which is the ordinary
 * kind of growth and today's four features.) The previous baseline wrote down
 * the reason — "`lib/i18n/ru.ts` is the heaviest module a page load still
 * fetches, at 92 KiB, because Metro escapes non-ASCII as `\uXXXX` and Cyrillic
 * costs six bytes a letter" — and treated it as a property of the bundle
 * rather than as a setting somebody had chosen. It is `output.ascii_only:
 * true` in Metro's terser preset, `metro.config.js` turns it off, and the two
 * Cyrillic locale maps now weigh what their text weighs: Belarusian 97 KiB →
 * 43, and 56 KiB off the EAGER entry chunk, where the default Russian locale
 * lives. `check-bundle-smoke` refuses to let it come back.
 *
 * **So this round is the mirror image of the last one.** That one changed
 * which CHUNK every Sentry bucket was in and moved the totals by 1.1 KiB; this
 * one changes no bucket's membership at all and takes 113 KiB out of two. A
 * report that only watched the totals would have called the first a no-op, and
 * one that only watched the rows would have nothing to say about the second
 * beyond "the copy got smaller" — which is why the report prints both, and why
 * `(lazy)` is a marker rather than a bucket.
 *
 * `totalBytes` here is above the gate's figure, because a sourcemapped export
 * appends a `sourceMappingURL` comment to each chunk and the deploy strips
 * them. It is the right number for THIS baseline — every bucket below was
 * measured in the same build — and the wrong one to compare against the
 * budget, which keeps its own figure in `lib/budget-snapshot.ts`. Compare
 * composition totals to composition totals.
 *
 * The headline facts as they stand now: 1282.5 KiB of the bundle is in chunks
 * a page load does not fetch — the five Sentry packages, the two PostHog ones,
 * and four of the six locale maps — and `lib/` is 442 KiB of this repository's
 * own code, of which the copy is still the largest part.
 */
export const COMPOSITION_BASELINE: CompositionBaseline = {
  takenOn: "2026-09-17",
  totalBytes: 3718329,
  buckets: {
    "(unattributed)": 625182,
    "lib/": 442000,
    "@sentry/core": 292950,
    "react-native-web": 282097,
    "app/": 198878,
    "@sentry/react-native": 195253,
    "react-dom": 171770,
    "expo-router": 154971,
    "components/": 127407,
    "@posthog/core": 127397,
    "@sentry-internal/replay": 123668,
    "posthog-react-native": 110926,
    "@supabase/auth-js": 106013,
    "@sentry/browser": 89827,
    "@react-navigation/core": 81554,
    "@sentry-internal/feedback": 48630,
    "@sentry-internal/browser-utils": 41413,
    "@react-navigation/elements": 34115,
    "@supabase/realtime-js": 33751,
    "@sentry/react": 30835,
    "@supabase/phoenix": 25050,
    "expo-auth-session": 24327,
    "@react-navigation/native": 23308,
    "@react-navigation/bottom-tabs": 21549,
    "expo-file-system": 20454,
    "@react-navigation/routers": 18093,
    "@expo/vector-icons": 17774,
    "@babel/runtime": 15900,
    "@sentry-internal/replay-canvas": 14702,
    "expo-modules-core": 14272,
    "react-native-screens": 13538,
    "tslib": 11255,
    "color-convert": 10175,
    "expo": 10000,
    "expo-font": 9170,
    "expo-image-picker": 8006,
    "expo-web-browser": 7932,
    "react": 7798,
    "expo-asset": 7483,
    "@react-native/normalize-colors": 7346,
    "react-native-safe-area-context": 6318,
    "color": 5860,
    "css-in-js-utils": 5740,
    "data/": 5603,
    "promise": 5490,
    "@react-navigation/native-stack": 5443,
    "query-string": 5194,
    "inline-style-prefixer": 5096,
    "expo-constants": 4898,
    "postcss-value-parser": 4773,
    "fontfaceobserver": 4360,
    "expo-linking": 4338,
    "expo-crypto": 4014,
    "react-is": 3956,
    "scheduler": 3510,
    "color-name": 3421,
    "color-string": 3164,
    "expo-linear-gradient": 2779,
    "@expo/cli": 2429,
    "@radix-ui/react-slot": 2331,
    "expo-status-bar": 2056,
    "@react-native-async-storage/async-storage": 2011,
    "react-fast-compare": 1738,
    "styleq": 1603,
    "merge-options": 1447,
    "base64-js": 1401,
  },
};
