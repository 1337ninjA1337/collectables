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
 */
config.transformer.minifierConfig = {
  ...config.transformer.minifierConfig,
  output: {
    ...config.transformer.minifierConfig?.output,
    ascii_only: false,
  },
};

module.exports = config;
