import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, readRepoFile } from "./helpers/repo-file";

/**
 * One definition of "read a file out of the repository".
 *
 * A hundred and forty-nine suites had their own. Nobody wrote it wrong; they
 * wrote it a hundred and forty-nine times, and by the end the copies differed
 * in ways nobody chose — one took an ABSOLUTE path where the rest took a
 * repo-relative one (same two lines, one `path.join` short, and nothing said
 * which convention a reader was looking at), one went through `fs.` rather
 * than a named import, and the root was spelled four ways.
 *
 * The migration is not self-defending: writing the two lines again is easy,
 * correct, and passes. So the sweep below is over the suite directory rather
 * than over a list, and carries a floor — a walk that finds no offenders is
 * indistinguishable from a walk that is broken.
 */

const TESTS_DIR = path.join(REPO_ROOT, "__tests__");
/** The one file allowed to open a repo-relative path itself. */
const HELPER = path.join("helpers", "repo-file.ts");

/**
 * {@link HELPER}, and this suite, which has to quote the retired shapes to
 * search for them. Asserted below rather than assumed, so a third entry is a
 * decision someone made out loud instead of a hole someone widened.
 */
const ALLOWED_TO_SPELL_THE_SHAPE: readonly string[] = [
  HELPER,
  "repo-file-helper.test.ts",
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

/** Source with runs of whitespace flattened, so a reformat cannot hide one. */
const flattened = (relative: string): string =>
  readRepoFile(path.join("__tests__", relative)).replace(/\s+/g, " ");

describe("reading a repo file, said once", () => {
  it("reads a real file, resolved from the repository root", () => {
    // `tsx --test` starts every suite with the repo root as cwd, which is what
    // makes `process.cwd()` and a path derived from this file agree — they
    // answer different questions, and cwd is the one a repo-relative path in a
    // test means.
    assert.ok(path.isAbsolute(REPO_ROOT));
    assert.equal(REPO_ROOT, process.cwd());
    assert.match(readRepoFile("package.json"), /"name": "collectables"/);
    assert.ok(readRepoFile("lib/i18n-source.ts").includes("parseObjectLiteral"));
  });

  it("throws on a path that is not there rather than answering with nothing", () => {
    // The right shape for a structural test: a suite asserting things about a
    // file it could not open should stop, not report every assertion as a
    // finding about the code.
    assert.throws(() => readRepoFile("lib/no-such-module.ts"), /ENOENT/);
  });

  it("leaves no suite declaring the read helper for itself", () => {
    // Matches the READ, not the words: plenty of suites still open a specific
    // file inline for one assertion, which is a different thing from carrying
    // a general `read(rel)`. What this catches is the parameterised form
    // coming back.
    const offenders = suiteFiles().filter((relative) => {
      if (ALLOWED_TO_SPELL_THE_SHAPE.includes(relative)) return false;
      const text = flattened(relative);
      return (
        text.includes('(rel: string) => readFileSync(') ||
        text.includes('(rel: string): string => readFileSync(') ||
        text.includes('(rel: string): string { return readFileSync(') ||
        text.includes('(rel: string) => fs.readFileSync(')
      );
    });
    assert.deepEqual(
      offenders,
      [],
      `these suites declare their own read helper instead of importing readRepoFile: ${offenders.join(", ")}`,
    );
  });

  it("keeps the exemption list to the two files that have to name the shape", () => {
    assert.deepEqual(ALLOWED_TO_SPELL_THE_SHAPE, [
      HELPER,
      "repo-file-helper.test.ts",
    ]);
    for (const allowed of ALLOWED_TO_SPELL_THE_SHAPE) {
      assert.ok(
        suiteFiles().includes(allowed),
        `exempted file ${allowed} is not in the walk — a stale entry exempts nothing and hides that it is stale`,
      );
    }
  });

  it("has enough readers that the sweep above is not scanning an empty room", () => {
    const files = suiteFiles();
    assert.ok(files.length > 200, `only ${files.length} suite files walked`);
    assert.ok(files.includes(HELPER), "the walk misses the helper itself");
    const readers = files.filter((relative) =>
      flattened(relative).includes("helpers/repo-file"),
    );
    assert.ok(
      readers.length >= 120,
      `only ${readers.length} suites read through the helper`,
    );
  });
});
