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
 * Layered on {@link readRepoFile} rather than reaching for `node:fs` itself:
 * this module's subject is WHICH file, and the general reader's is how the
 * suites reach the tree. Two independent openers of the same tree is the
 * duplication one level up from the one this file removed.
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

import path from "node:path";

import {
  I18N_LOCALE_SOURCES,
  I18N_PROVIDER_SOURCE,
  I18N_TYPES_SOURCE,
} from "../../lib/i18n-source-files";

import { REPO_ROOT, readRepoFile } from "./repo-file";

/** The module's location, repo-relative — the one statement of it. */
export const I18N_SOURCE_REL = I18N_PROVIDER_SOURCE;

/** The same location absolute, for the case that pins what it resolves to. */
export const I18N_SOURCE_PATH = path.join(REPO_ROOT, I18N_SOURCE_REL);

/** Where the three shared types live — `AppLanguage` among them. */
export const I18N_TYPES_SOURCE_REL = I18N_TYPES_SOURCE;

/**
 * The six locale maps, which are modules of their own since 2026-09-13.
 *
 * They were 3696 of `i18n-context.tsx`'s 3929 lines, and they moved so that
 * four of them can eventually be fetched on demand rather than shipped to
 * every visitor. `en` first because it is the key set the other five are
 * checked against, then the order `languageOptions` lists.
 */
export const I18N_LOCALE_SOURCE_RELS: readonly string[] = I18N_LOCALE_SOURCES;

/**
 * The translations module's source text.
 *
 * Ask this for the text and `lib/i18n-source.ts` for what the text declares —
 * `findLocaleBlock`, `localeKeys`, `findLanguageOptions`. A suite that matches
 * the string returned here with a regex of its own is re-deriving what the
 * parser already knows, which is the habit that parser exists to end.
 */
export function readI18nSource(): string {
  // `.map((rel) => …)` and not `.map(readRepoFile)`: the reader takes path
  // SEGMENTS, so a point-free map hands it the array index as a second
  // segment and every call throws on the number.
  return [I18N_SOURCE_REL, I18N_TYPES_SOURCE_REL, ...I18N_LOCALE_SOURCE_RELS]
    .map((rel) => readRepoFile(rel))
    .join("\n");
}

/**
 * Just the provider's own file — the questions that are about the MODULE
 * rather than about the copy: what it imports, what it exports, what the
 * provider does on mount.
 *
 * {@link readI18nSource} answers the other kind, and after the locale split it
 * has to be a concatenation to do it: a hundred suites ask "does every locale
 * declare this key", which was one file's text until the maps became six
 * modules and is now seven files' text. Joining them keeps that question
 * answerable in one call, and `lib/i18n-source.ts` reads top-level
 * declarations rather than offsets, so a concatenation is the same subject
 * the single file was.
 */
export function readI18nProviderSource(): string {
  return readRepoFile(I18N_SOURCE_REL);
}
