import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/env-inlining";

import {
  I18N_SOURCE_REL,
  readI18nSource,
} from "./helpers/i18n-source-file";
import {
  REPO_ROOT,
  readRepoFile,
  repoPath,
  repoRelative,
} from "./helpers/repo-file";

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
 *
 * The rule the sweep states is the simplest one available: a suite does not
 * DERIVE the repository root, by either route. Its predecessors each
 * enumerated a SHAPE — a `(rel: string) => readFileSync(...)` helper, then
 * `readFileSync( path.join( process.cwd(), "` — and each had a next near-miss
 * waiting (`fs.readFileSync`, a `const cwd = process.cwd()` assigned first, a
 * `readdirSync` walk that never reads a file at all). Naming the root is the
 * one thing all of them do, and with `repoPath`/`repoRelative` beside the
 * reader there is nothing left that a suite legitimately needs it for.
 *
 * BOTH routes, because banning only `process.cwd()` left the near-miss the
 * rule was meant to end: forty-three suites derived the same root as
 * `path.join(__dirname, "..")` and the sweep waved every one of them through.
 * They agree — `tsx --test` runs each suite from the repository root, which is
 * the premise the first case below pins — so this is a spelling being reduced
 * to one, not a resolution being changed. `__dirname` also stops meaning the
 * repo root the moment a suite moves into a subdirectory, which the
 * `helpers/` files had already had to write as `"..", ".."`.
 *
 * Note for whoever turns this red: a case HERE that names a specific file is
 * caught by `i18n-source-file.test.ts`'s own "said once" sweep if that file is
 * `lib/i18n-context.tsx`, and vice versa — the two guards check each other's
 * suites, which is intended and looks like a confusing unrelated failure the
 * first time you meet it.
 */

const TESTS_DIR = repoPath("__tests__");
/** The one file allowed to open a repo-relative path itself. */
const HELPER = path.join("helpers", "repo-file.ts");

/**
 * {@link HELPER}, and the three suites that have to quote a retired shape to
 * search for it. Asserted below rather than assumed — including that each
 * entry still NEEDS the exemption — so a fifth is a decision someone made out
 * loud instead of a hole someone widened.
 *
 * `lint-guard-empty-root.test.ts` is here for a different reason than the
 * others: it is not about suites at all. It matches `path.join(__dirname,
 * "..")` inside the guard SCRIPTS under `scripts/`, where that shape is the
 * sanctioned default root and appearing twice is the bug it looks for.
 */
const ALLOWED_TO_SPELL_THE_SHAPE: readonly string[] = [
  HELPER,
  "repo-file-helper.test.ts",
  "i18n-source-file.test.ts",
  "lint-guard-empty-root.test.ts",
];

/** The two ways a suite used to derive the root, and the rule is neither. */
const ROOT_DERIVATIONS: readonly string[] = ["process.cwd()", "__dirname"];

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
  readRepoFile("__tests__", relative).replace(/\s+/g, " ");

/**
 * The same with comments removed first.
 *
 * The `process.cwd()` rule is about what a suite DOES, and prose is where the
 * decision gets explained — the helper's own doc comment quotes the shape it
 * retired, and so does this one. Stripping comments is what lets the rule stay
 * "not at all" instead of growing an exemption per file that mentions it.
 */
const code = (relative: string): string =>
  stripComments(readRepoFile("__tests__", relative)).replace(/\s+/g, " ");

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

  it("leaves no suite deriving the repository root, by either route", () => {
    // The rule that replaced two shape lists. `readFileSync( path.join(
    // process.cwd(), "app", "index.tsx"), "utf8")` was the shape the previous
    // sweep matched, and it walked straight past `fs.readFileSync`, past a
    // `const cwd = process.cwd()` assigned first, and past the ~120 calls that
    // never read a file at all — `readdirSync(path.join(process.cwd(), dir))`
    // anchoring a walk, `path.relative(process.cwd(), file)` turning a hit
    // back into a reportable name. Those are `repoPath` and `repoRelative`
    // now, which is what makes "not at all" a rule a suite can actually keep.
    for (const derivation of ROOT_DERIVATIONS) {
      const offenders = suiteFiles().filter((relative) => {
        if (ALLOWED_TO_SPELL_THE_SHAPE.includes(relative)) return false;
        return code(relative).includes(derivation);
      });
      assert.deepEqual(
        offenders,
        [],
        `these suites derive the repo root via ${derivation} instead of going through repoPath/readRepoFile/repoRelative: ${offenders.join(", ")}`,
      );
    }
  });

  it("pins the premise that makes the two derivations one path", () => {
    // The migration folded `path.join(__dirname, "..")` into `REPO_ROOT`
    // across forty-three suites, which is only a spelling change while this
    // holds: `tsx --test` starts every suite with the repository root as cwd.
    // If it ever stops holding, this fails here rather than as forty-three
    // ENOENTs with no indication that they are one fact.
    assert.equal(REPO_ROOT, process.cwd());
    assert.equal(repoPath("__tests__"), path.dirname(new URL(import.meta.url).pathname));
  });

  it("joins segments or a slash-joined string to the same path, either helper", () => {
    // The convention question the migration had to settle: `path.join`
    // normalises separators, so the two spellings are one path on both
    // platforms Node supports and a call site can use whichever reads better.
    assert.equal(repoPath("lib", "i18n-source.ts"), repoPath("lib/i18n-source.ts"));
    assert.equal(repoPath("lib/i18n-source.ts"), path.join(REPO_ROOT, "lib", "i18n-source.ts"));
    assert.equal(readRepoFile("lib", "i18n-source.ts"), readRepoFile("lib/i18n-source.ts"));
    // And the reader is layered on the path rather than joining its own.
    assert.match(readRepoFile("__tests__/helpers/repo-file.ts"), /readFileSync\(repoPath\(/);
  });

  it("sends an absolute path back the way a walk reports it", () => {
    // The other half of a sweep: `readdirSync` hands back absolute paths, and
    // an assertion message naming the runner's checkout prefix spends the
    // reader's eye on the part that is the same for every offender.
    assert.equal(repoRelative(repoPath("lib", "i18n-source.ts")), path.join("lib", "i18n-source.ts"));
    assert.equal(repoRelative(REPO_ROOT), "");
    // Round-trips with `repoPath`, which is the property the walks rely on.
    assert.equal(repoPath(repoRelative(repoPath("app/index.tsx"))), repoPath("app/index.tsx"));
  });

  it("is what the i18n reader is layered on, rather than a second opener", () => {
    // `readI18nSource` reached for `node:fs` directly when it shipped this
    // morning, which made two independent openers of one tree — the
    // duplication one level up from the one it removed. Its subject is WHICH
    // file; this module's is how the suites reach the tree.
    const helper = readRepoFile("__tests__/helpers/i18n-source-file.ts");
    assert.match(helper, /from "\.\/repo-file"/);
    assert.doesNotMatch(helper, /from "node:fs"/);
    // Through the module's own constant, not a second literal — the path is
    // said once and this case is about the layering, not about the name.
    assert.equal(readI18nSource(), readRepoFile(I18N_SOURCE_REL));
  });

  it("keeps the exemption list to the four files that have to name the shape", () => {
    assert.deepEqual(ALLOWED_TO_SPELL_THE_SHAPE, [
      HELPER,
      "repo-file-helper.test.ts",
      "i18n-source-file.test.ts",
      "lint-guard-empty-root.test.ts",
    ]);
    for (const allowed of ALLOWED_TO_SPELL_THE_SHAPE) {
      assert.ok(
        suiteFiles().includes(allowed),
        `exempted file ${allowed} is not in the walk — a stale entry exempts nothing and hides that it is stale`,
      );
      // And each one still NEEDS the exemption: the helper declares the root,
      // this suite pins it, and the other two quote a retired shape as a
      // string to search for. An entry that stopped using it is an exemption
      // standing open for the next suite to walk through.
      assert.ok(
        ROOT_DERIVATIONS.some((derivation) => code(allowed).includes(derivation)),
        `${allowed} is exempted from the root rule but no longer names the root — drop the entry`,
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
    // Raised from 120 when the `process.cwd()` sweep landed and another ~85
    // suites came through the helper. Deliberately well under the ~290 that
    // import it today: this floor exists to catch a BROKEN walk, not to track
    // the count, and suites get deleted for reasons that have nothing to do
    // with how they reach the tree.
    assert.ok(
      readers.length >= 250,
      `only ${readers.length} suites read through the helper`,
    );
  });
});
