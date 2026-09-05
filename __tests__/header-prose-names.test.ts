import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { measuredFloor } from "./helpers/coverage-floor";
import { classifyProseName, moduleDoc, proseNames } from "./helpers/module-doc";
import { repoPath } from "./helpers/repo-file";
import { readSource, sourceCode, sourceFiles } from "./helpers/source-files";
import { suiteCode, suiteFiles } from "./helpers/suite-files";

/**
 * Every module header in the source tree, checked against the code it points at.
 *
 * ## What this is, and what it was
 *
 * `audit-baseline.test.ts` reads ONE header — the gate script's — and holds it
 * to a strict rule: a name it points at must be EXPORTED by `lib/` or
 * `scripts/`, because that header's whole claim is that a reader can go and
 * find `runAuditGate`. That case was written because the gate's decisions had
 * just moved into `lib/` and the paragraph describing them had moved by hand.
 *
 * Running the same classifier over the rest of the tree, while it was being
 * written, named two headers that were already wrong: `lib/deployment-env.ts`
 * described a `normaliseEnvironment` renamed weeks earlier, and
 * `lib/check-profile-id-pii.ts` said `toProfileRow` writes `public_id` back to
 * the cloud when the writer has been `upsertProfileBody` since. Both were fixed
 * by hand, and the sweep that found them existed for the length of one probe —
 * which means the next one is found the next time somebody happens to run it.
 * This is that probe, kept.
 *
 * ## The rule is looser here, deliberately
 *
 * Resolution is "the name appears somewhere in this tree's code", not "somebody
 * exports it". The strict rule is right for one header making one claim and
 * wrong for two hundred and fifty-seven making every kind: source headers name
 * parameters (`intervalMs`, `pageSize`), JSX props (`accessibilityLabel`,
 * `onEndReached`), object fields, and env var names, none of which is an
 * export and every one of which a reader can find. Demanding exports here
 * reports sixty-eight files, almost all of them correct prose — the rule
 * somebody exempts and then ignores.
 *
 * What survives the loosening is the failure that actually happens: a rename
 * moves the code and leaves the paragraph naming something that is now nowhere
 * at all. Both real finds above are of exactly that shape, and both are caught
 * by the loose rule.
 *
 * ## And the foreign vocabulary
 *
 * Three headers quote names from outside this repository — Node's error codes,
 * the ECMAScript grammar's production names — and no rule reading shapes can
 * tell `ERR_MODULE_NOT_FOUND` from `LINT_GUARDS`. {@link FOREIGN} is that hole,
 * held open on purpose and held to the same terms every allow-list here is: it
 * is compared against a separate literal so widening it means finding both, and
 * each entry has to still be doing work. An exemption that stopped being needed
 * is a hole standing open for the next reader, and nothing about it looks stale.
 */

/**
 * Names quoted from somewhere that is not this repository.
 *
 * Each is a term of art a header has to spell exactly, from a source this tree
 * does not contain: Node's module-loader error codes, and four productions of
 * the ECMAScript lexical grammar that `lib/js-tokens.ts` implements. The entry
 * is the name; the comment beside it is where it comes from, which is the half
 * that makes the next reader able to judge whether a fifth belongs here.
 */
const FOREIGN: Readonly<Record<string, string>> = {
  // Node, thrown by the ESM loader before any suite runs.
  ERR_MODULE_NOT_FOUND: "node:internal/modules",
  ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: "node:internal/modules",
  // ECMAScript lexical grammar — the goal symbols and productions the tokeniser
  // in `lib/js-tokens.ts` is written against.
  InputElementDiv: "ECMA-262 lexical grammar",
  InputElementRegExp: "ECMA-262 lexical grammar",
  RegularExpressionLiteral: "ECMA-262 lexical grammar",
  ReservedWord: "ECMA-262 lexical grammar",
};

/** The same list again, as the tripwire `assertExemptionsHonest` argues for. */
const EXPECTED_FOREIGN = [
  "ERR_MODULE_NOT_FOUND",
  "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
  "InputElementDiv",
  "InputElementRegExp",
  "RegularExpressionLiteral",
  "ReservedWord",
];

/**
 * This file's own name in the suite walk, asked of the runtime.
 *
 * Written first as the literal `"header-prose-names.test.ts"`, which is a
 * filename typed into the file it names: a rename leaves the constant pointing
 * at a suite that is not there, the exclusion below stops excluding anything,
 * and every entry in {@link FOREIGN} quietly resolves itself again. The case
 * that catches that is one assertion away from the walk it protects, and
 * `import.meta.url` answers the same question with nothing to keep in step —
 * the spelling `suite-files-helper.test.ts` and `repo-file-helper.test.ts`
 * already use to ask where they are.
 */
const SELF = path.basename(new URL(import.meta.url).pathname);

/**
 * Every identifier that occurs in the tree's code, comments stripped.
 *
 * Suites and helpers are in it as well as source, and both halves earn their
 * place. A header in `lib/` naming `sourceCodeFlat` or `suiteCode` points at
 * `__tests__/helpers/`; a header naming `SCAN_ROOTS`, `balancedParens` or
 * `nanoidLike` points at a spelling that survives in the suite covering the
 * change, which is exactly where a reader asking "what was this called before?"
 * should land. Walking only source calls five of those missing.
 *
 * THIS file is the one exclusion, and it is not tidiness. {@link FOREIGN} is a
 * list of names the tree does NOT contain, written as object keys — which are
 * identifiers. Index them and every exemption resolves itself: the allow-list
 * cancels the allow-list, and the rule is green because it is broken. A file
 * whose content is an inventory of what is absent cannot be evidence of what is
 * present.
 *
 * Comments are stripped for the one reason that decides this rule's worth: a
 * header is a comment, so an index built from raw text would find every name in
 * the sentence that names it and agree with itself forever.
 */
const inCode = new Set<string>();
for (const file of sourceFiles()) {
  for (const match of sourceCode(file).matchAll(/[A-Za-z_$][\w$]*/g)) inCode.add(match[0]);
}
for (const file of suiteFiles().filter((file) => file !== SELF)) {
  for (const match of suiteCode(file).matchAll(/[A-Za-z_$][\w$]*/g)) inCode.add(match[0]);
}

/**
 * Every header in the source tree, extracted once.
 *
 * Three cases below want the same 257 headers, and the first version walked
 * and re-extracted for each of them: `unresolved()` read a file and built its
 * `proseNames`, the floors case read the same file and built the same result
 * again, and the honesty case did it a third time. `readSource` is cached and
 * the extraction is not, so what was being paid three times was the half that
 * costs something.
 */
const HEADERS: readonly { readonly file: string; readonly names: ReturnType<typeof proseNames> }[] =
  sourceFiles()
    .filter((file) => readSource(file).includes("/**"))
    .map((file) => ({ file, names: proseNames(moduleDoc(readSource(file))) }));

describe("what the source headers point at", () => {
  it("names no identifier that is nowhere in the tree", () => {
    // Reported as one list rather than one case per file: a rename touches a
    // header in `lib/` and the two in `components/` that describe it, and three
    // separate red cases read as three problems.
    //
    // Separate from the path case below because they are separate findings.
    // One sentence covering both said "does not exist anywhere in this tree"
    // for a file somebody MOVED and for a function somebody RENAMED, and the
    // only thing telling them apart was a marker on half the rows.
    const offenders = HEADERS.flatMap(({ file, names }) =>
      names.identifiers
        .filter((name) => !inCode.has(name) && FOREIGN[name] === undefined)
        .map((name) => `${file}: ${name}`),
    ).sort();
    assert.deepEqual(
      offenders,
      [],
      `these module headers name code that is nowhere in this tree:\n  ${offenders.join("\n  ")}\nA rename moves the import and leaves the paragraph — which is the first thing the next contributor reads, and the only thing telling them where to go`,
    );
  });

  it("names no path that is not on disk", () => {
    const offenders = HEADERS.flatMap(({ file, names }) =>
      names.paths.filter((rel) => !existsSync(repoPath(rel))).map((rel) => `${file}: ${rel}`),
    ).sort();
    assert.deepEqual(
      offenders,
      [],
      `these module headers point at files that are not there:\n  ${offenders.join("\n  ")}\nA moved file leaves every paragraph that named it as directions to nowhere`,
    );
  });

  it("sweeps enough headers, and claims enough names in them, to mean something", () => {
    // Both floors are measured. The first says the walk still reaches the tree;
    // the second says the classifier still claims names in it — a shape rule
    // tightened until it claims nothing passes this suite in silence, and the
    // green run would look exactly like the green run a correct tree gets.
    //
    // The floors are set at roughly half of what the tree carries (257 headers,
    // 311 names) rather than just under it. A floor eleven names below the
    // measurement is a tripwire on somebody rewriting one paragraph in plain
    // words, and a red run about prose style is a red run nobody keeps.
    assert.ok(
      HEADERS.length >= 130,
      measuredFloor(HEADERS.length, 130, "source file(s) carrying a module header"),
    );
    const claimed = HEADERS.reduce(
      (total, { names }) => total + names.identifiers.length + names.paths.length,
      0,
    );
    assert.ok(
      claimed >= 150,
      measuredFloor(claimed, 150, "name(s) the headers point at and this rule resolves"),
    );
  });
});

describe("the foreign vocabulary these headers are allowed to quote", () => {
  it("is excluded from the index it is an exemption from", () => {
    // The bug this was written after: with every suite indexed, the six keys
    // below ARE identifiers in a file the walk reads, so all six resolved
    // themselves and the honesty case reported them as no longer needed. The
    // exclusion is what makes the list mean anything, so it is stated here
    // rather than left to the walk's filter.
    assert.ok(
      suiteFiles().includes(SELF),
      `${SELF} is not in the suite walk, so excluding it from the index is exempting nothing — the name has changed`,
    );
    for (const name of Object.keys(FOREIGN)) {
      assert.ok(
        suiteCode(SELF).includes(name),
        `${name} is not in this file's own code, so the exclusion above is not what keeps it unresolved`,
      );
    }
  });

  it("is the list it was, entry for entry", () => {
    // The literal above and the tripwire below are separate on purpose: the
    // record lives at module scope and this case sits below it, so widening the
    // hole means finding both. One literal would agree with itself.
    assert.deepEqual(Object.keys(FOREIGN).sort(), EXPECTED_FOREIGN);
    assert.ok(Object.keys(FOREIGN).length > 0, "the list is empty — delete it instead");
  });

  it("says where each name comes from, because that is what makes a fifth judgeable", () => {
    for (const [name, origin] of Object.entries(FOREIGN)) {
      assert.ok(origin.length > 0, `${name} is exempt and nothing says what it is quoted from`);
    }
  });

  it("holds only names some header still quotes and this tree still lacks", () => {
    // The half worth having: an entry that stopped doing the thing exempts
    // nothing, and a name that arrived in the code since is a hole standing
    // open over a name the rule would now resolve on its own.
    const quoted = new Set(HEADERS.flatMap(({ names }) => names.identifiers));
    for (const name of Object.keys(FOREIGN)) {
      assert.ok(
        quoted.has(name),
        `${name} is exempt from the header rule and no header names it — drop the entry rather than leaving the hole open`,
      );
      assert.ok(
        !inCode.has(name),
        `${name} is exempt from the header rule and is now in the tree's code — the rule resolves it without help`,
      );
      assert.equal(
        classifyProseName(name),
        "identifier",
        `${name} is exempt from a rule that would not have claimed it — the entry exempts nothing`,
      );
    }
  });
});
