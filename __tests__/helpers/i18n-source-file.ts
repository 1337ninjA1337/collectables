/**
 * Where `lib/i18n-context.tsx` is, said once.
 *
 * Fifty suites read that file's TEXT rather than importing it — the module
 * pulls React Native peers, so a structural question about it has to be asked
 * of the source — and each of them spelled the location for itself. Two
 * habits, both copied file to file: `readFileSync(path.join(process.cwd(),
 * "lib", "i18n-context.tsx"), "utf8")` written out in fourteen suites, and
 * `read("lib/i18n-context.tsx")` through a local `read(rel)` helper in
 * thirty-six more. Fifty statements of one fact, agreeing because nobody had
 * moved the file.
 *
 * Moving it is the case that matters, and it is the one where spelling it
 * fifty times costs the most: `i18n-context.tsx` is the file every locale map
 * lives in, so a rename would turn fifty suites red at once with fifty
 * identical ENOENTs and no indication that they are one edit. Reading through
 * here makes it one.
 *
 * Not a memoisation. `tsx --test` runs each suite in its own process, so the
 * fifty reads happen either way and a cache here could only ever hit within a
 * single file — a suite that reads the source twice in one process is welcome
 * to hold the string in a `const`, which is what they all already do.
 *
 * Why here and not beside the parser, which is where a first reading of the
 * suggestion would put it: `lib/i18n-source.ts` takes source TEXT and returns
 * what it found, and `lib/i18n-coverage.ts` is written the same way and says
 * so ("Node-pure on purpose, and measured from the source rather than from an
 * import"). Neither touches the filesystem, which is what lets a bundler see
 * them as ordinary modules. Putting `node:fs` in `lib/` to save fifty test
 * lines would trade a property of the shipped tree for tidiness in the suites,
 * so the path lives on the suites' side of that line.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/** Absolute path to the translations module, resolved from the repo root. */
export const I18N_SOURCE_PATH = path.join(
  process.cwd(),
  "lib",
  "i18n-context.tsx",
);

/**
 * The translations module's source text.
 *
 * Ask this for the text and `lib/i18n-source.ts` for what the text declares —
 * `findLocaleBlock`, `localeKeys`, `findLanguageOptions`. A suite that matches
 * the string returned here with a regex of its own is re-deriving what the
 * parser already knows, which is the habit that parser exists to end.
 */
export function readI18nSource(): string {
  return readFileSync(I18N_SOURCE_PATH, "utf8");
}
