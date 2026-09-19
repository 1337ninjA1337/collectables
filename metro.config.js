const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

/**
 * Emit UTF-8, not `\uXXXX` escapes.
 *
 * Metro's terser preset sets `output.ascii_only: true`, which rewrites every
 * non-ASCII character in the bundle as a six-byte escape. For an app whose UI
 * is translated into Russian and Belarusian that is not a rounding error: a
 * Cyrillic letter costs two bytes in UTF-8 and six as a backslash-u escape,
 * so the two Cyrillic locale chunks were carrying three times the bytes of
 * their Latin siblings for the same 554 keys: 97 KiB of Belarusian for 43 KiB
 * of text, and 56 KiB of the same waste in the EAGER entry chunk, where the
 * Russian default locale lives.
 *
 * Safe because every consumer of these files declares UTF-8: `dist/index.html`
 * carries `<meta charset="utf-8">`, and GitHub Pages serves `.js` with
 * `charset=utf-8` in the Content-Type. A script with no charset on the
 * response inherits the document's anyway, which is the same answer.
 *
 * The other three options are Metro's own and are kept verbatim rather than
 * replaced: `quote_style: 3` (leave quotes as written) and `wrap_iife` both
 * change output the rest of the toolchain expects, and dropping them by
 * assigning a fresh `output` object is the way this edit would go wrong.
 *
 * ## The rest of the preset, measured on 2026-09-19 — and left alone
 *
 * `ascii_only` was one setting in a config nobody had opened, so the obvious
 * follow-up was asked three days running: what about the others? One build
 * each, against a 3,718,641-byte bundle:
 *
 *  - `compress.reduce_funcs: true` — 33 bytes smaller. 0.0009%, and React
 *    Native disables it deliberately, because inlining single-use functions
 *    moves work from the wire onto startup. Not a trade.
 *  - `mangle.toplevel: true` and `toplevel: true` — ZERO bytes, byte for byte
 *    across all seven chunks, and for a structural reason rather than by luck:
 *    Metro wraps every module in a `__d(function (global, require, …) { … })`
 *    factory, so there is no top level to mangle or shake. Whatever these
 *    options are for, this bundle shape cannot reach it.
 *  - `output.quote_style`, `output.wrap_iife`, `sourceMap.includeSources` —
 *    not size questions; the last one affects only a build that emits
 *    sourcemaps, and the deploy strips them.
 *
 * So Metro is right about all of them and nothing here changes. The numbers and
 * the reasoning live in `lib/minifier-audit.ts`, which a suite checks against
 * the preset the toolchain actually sends — because a measurement is only as
 * good as the config it was taken against, and a dependency bump can move a
 * default without moving anything anybody would notice.
 */
config.transformer.minifierConfig = {
  ...config.transformer.minifierConfig,
  output: {
    ...config.transformer.minifierConfig?.output,
    ascii_only: false,
  },
};

module.exports = config;
