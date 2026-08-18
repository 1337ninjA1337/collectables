import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { findLanguageOptions, localeKeys } from "@/lib/i18n-source";
import {
  I18N_SOURCE_PATH,
  readI18nSource,
} from "./helpers/i18n-source-file";

/**
 * One statement of where `lib/i18n-context.tsx` is.
 *
 * Fifty suites read that file's text — it pulls React Native peers, so a
 * structural question about it is asked of the source — and each spelled the
 * location itself, in one of two habits copied file to file: the `path.join`
 * written out, or a repo-relative string handed to a local `read(rel)`. Fifty
 * copies of one fact, all correct, none of them the place a rename would be
 * made.
 *
 * These cases are the half that keeps the consolidation true. The migration
 * itself is not self-defending: nothing stops the next suite from writing the
 * join again, and it would be right, and it would pass — which is how the
 * fifty accumulated. So the sweep below is over the suite directory rather
 * than over a list of files, and it carries a floor, because a guard that
 * scans a directory and finds nothing is indistinguishable from one whose
 * scan is broken.
 */

const TESTS_DIR = path.join(process.cwd(), "__tests__");
/** The one file allowed to name the translations module's location. */
const HELPER = path.join("helpers", "i18n-source-file.ts");

/** {@link HELPER}, and this suite, which asserts the value it resolves to. */
const ALLOWED_TO_SPELL_THE_PATH: readonly string[] = [
  HELPER,
  "i18n-source-file.test.ts",
];

/** Every `.ts` under `__tests__`, one level of subdirectory included. */
function suiteFiles(): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(TESTS_DIR)) {
    const full = path.join(TESTS_DIR, entry);
    if (statSync(full).isDirectory()) {
      for (const nested of readdirSync(full)) {
        if (nested.endsWith(".ts")) found.push(path.join(entry, nested));
      }
      continue;
    }
    if (entry.endsWith(".ts")) found.push(entry);
  }
  return found;
}

/** Source with runs of whitespace flattened, so a reformat cannot hide a join. */
const flattened = (relative: string): string =>
  readFileSync(path.join(TESTS_DIR, relative), "utf8").replace(/\s+/g, " ");

describe("the translations module's path, said once", () => {
  it("reads the real file, and the parser can answer questions about it", () => {
    // Not a mock and not a fixture: the point of the helper is that it opens
    // the file every locale map lives in. `localeKeys` throws on a map it
    // cannot find, so a wrong path here fails as a missing block rather than
    // as an empty string nobody notices.
    const source = readI18nSource();
    assert.ok(source.length > 1000);
    assert.ok(localeKeys(source, "en").size > 100);
    assert.deepEqual(
      findLanguageOptions(source).map((option) => option.code),
      ["ru", "en", "be", "pl", "de", "es"],
    );
  });

  it("resolves from the repo root rather than from the importing suite", () => {
    // `tsx --test` runs each suite in its own process with the repo root as
    // cwd, which is why `process.cwd()` is the right anchor and why a helper
    // resolving from `import.meta.url` would answer a different question.
    assert.ok(path.isAbsolute(I18N_SOURCE_PATH));
    assert.equal(
      I18N_SOURCE_PATH,
      path.join(process.cwd(), "lib", "i18n-context.tsx"),
    );
    assert.equal(readFileSync(I18N_SOURCE_PATH, "utf8"), readI18nSource());
  });

  it("is the only file under __tests__ that spells the path to READ it", () => {
    // The assertion that outlives the migration. Two things it deliberately
    // does not do. It does not match the bare filename: naming the module in
    // prose is what a doc comment is for, and `security-review-wiring.test.ts`
    // lists it as one path among several in a fixture for a workflow's glob
    // filter, which is a string about CI and not a file being opened. And it
    // does not match on one line: whitespace is flattened first, so a
    // prettier-wrapped join — which is how the helper's own is written, and so
    // is how a copy of it would be — is caught the same as a one-liner.
    const offenders = suiteFiles().filter((relative) => {
      if (ALLOWED_TO_SPELL_THE_PATH.includes(relative)) return false;
      const text = flattened(relative);
      return (
        // `path.join(process.cwd(), "lib", "i18n-context.tsx")`, and the
        // inline `require("node:path").join(…)` one suite reached for.
        text.includes('process.cwd(), "lib", "i18n-context.tsx"') ||
        // the repo-relative string handed to a local `read(rel)`.
        text.includes('("lib/i18n-context.tsx")')
      );
    });
    assert.deepEqual(
      offenders,
      [],
      `these suites spell the translations module's path instead of importing readI18nSource: ${offenders.join(", ")}`,
    );
  });

  it("keeps the exemption list to the two files that have to say the path", () => {
    // An allow-list is a hole, so it is asserted rather than assumed: the
    // helper, because it is the one statement, and this suite, because pinning
    // the value is what the case above it does. A third entry means someone
    // widened the hole instead of importing the helper.
    assert.deepEqual(ALLOWED_TO_SPELL_THE_PATH, [
      HELPER,
      "i18n-source-file.test.ts",
    ]);
    for (const allowed of ALLOWED_TO_SPELL_THE_PATH) {
      assert.ok(
        suiteFiles().includes(allowed),
        `exempted file ${allowed} is not in the walk — a stale entry exempts nothing and hides that it is stale`,
      );
    }
  });

  it("has enough readers that the sweep above is not scanning an empty room", () => {
    // A floor, not a count: the walk finding no offenders means nothing unless
    // it is also finding the suites. Set well under the 50 that migrated, so
    // deleting a suite does not turn this red for the wrong reason — what it
    // catches is the walk itself breaking (a renamed directory, a changed
    // extension) and reporting a clean tree.
    const files = suiteFiles();
    assert.ok(files.length > 200, `only ${files.length} suite files walked`);
    assert.ok(files.includes(HELPER), "the walk misses the helper itself");
    const readers = files.filter((relative) =>
      flattened(relative).includes("readI18nSource"),
    );
    assert.ok(
      readers.length >= 40,
      `only ${readers.length} suites read through the helper`,
    );
  });
});
