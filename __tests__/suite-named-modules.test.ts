import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { measuredFloor } from "./helpers/coverage-floor";
import { sourceFiles } from "./helpers/source-files";
import { suiteCode, suiteFiles } from "./helpers/suite-files";

/**
 * Which modules of the app tree no suite so much as names.
 *
 * ## What this replaces
 *
 * The list existed before this file did, twice, and both times as a one-off
 * script run inside a session: "five modules are still mentioned by no suite"
 * went into `.tasks/.suggestions.md` on 2026-09-05, and the entry beside it
 * said the honest thing about its own provenance — nothing in the tree
 * measures that list, so a sixth is a DISCOVERY somebody happens to make
 * rather than a red run. It was already stale when it was written: the census
 * below found six, and `lib/deep-link.ts` — `buildDeepLink`, imported by
 * `app/item/[id].tsx` and `components/collection-share-sheet.tsx` — was the
 * one the script missed, because it matched on a bare word that other suites
 * use in prose about links. It has `deep-link.test.ts` now, which is what an
 * exemption entry was for: a hole with the work written next to it. The list
 * is gone because all six closed; the paragraph below it says why it is prose
 * now and what re-adding it would mean.
 *
 * That is the whole argument for keeping the walk: the population only moves
 * when somebody adds a module or writes a suite, both of which are deliberate,
 * and the direction that matters (a new module nothing tests) is invisible in
 * every other check here. `coverage-floor.ts` calls this a MEASURED floor and
 * says what a move in it means.
 *
 * ## The rule is "named", not "covered", and the gap is the point
 *
 * A suite naming a module is the floor below which no coverage claim can be
 * true. It is not coverage: `plural.test.ts` names half the tree in the sweeps
 * it runs over it, and being swept is not being tested. What a red run here
 * says is narrower and still worth a failure — this module has never been
 * CONSIDERED. Nobody imported it, nobody read its source, no rule walked past
 * it with its name in hand.
 *
 * The stronger question (which modules does a suite EXERCISE) is
 * `coverage-floor.ts`'s and the per-module suites'. This one is deliberately
 * the weak half, because the weak half is the one that can be answered over
 * the whole tree without a runner.
 *
 * ## Two spellings, because the tree writes a module reference two ways
 *
 * `@/lib/use-now` in an import, and `readRepoFile("lib", "supabase-cloudinary
 * .ts")` where the same path is split across two arguments. A rule with only
 * the first reported `lib/supabase-cloudinary.ts`,
 * `lib/supabase-data-export.ts` and `lib/use-debounced-value.ts` as unnamed —
 * all three have suites of their own, named after them. So a module counts as
 * named when a suite's code contains either its path without the extension
 * ({@link stemOf}) or its file name with it.
 *
 * The file-name half is the loose one: two modules could share a basename and
 * one suite's mention would answer for both. `[id].tsx` is the only basename
 * this tree repeats, and all five of those are reached by their stems, so the
 * hole is currently empty — which is a fact worth a case rather than a
 * sentence, because it stops being true the first time somebody adds a second
 * `helpers.ts`.
 *
 * ## Comments are stripped, and this file is excluded
 *
 * Stripped because prose is where a module gets DISCUSSED — half the headers
 * in `__tests__/` name a module to explain what a rule is not about — and a
 * mention in a paragraph is exactly the mention this rule should not accept.
 *
 * Excluded for the reason `header-prose-names.test.ts` excludes itself from
 * its own index: an exemption list here is an inventory of modules nothing
 * names, written as string keys, which are code. Index this file and every
 * exemption resolves itself, the allow-list cancels the allow-list, and the
 * sweep is green because it is broken. The list is empty today and the
 * exclusion still holds — it is what makes re-adding one safe.
 */

/**
 * The directories whose modules ship to a user, which is not all of the source.
 *
 * `scripts/` is source and it is TypeScript and it is deliberately out of the
 * walk. A guard wrapper there is named by `LINT_GUARDS` in
 * `lib/lint-guards.ts` and reached through THAT — `guard-registration.test.ts`
 * walks the registry and asks four other registries about each entry, none of
 * it by typing the path into a suite. Nine of the fifteen wrappers would be
 * unnamed here for that reason, and they are among the most heavily checked
 * files in the tree. A census over them measures whether a registry spells its
 * members out, which is a different question with a different answer.
 */
const APP_TREE = ["app", "components", "data", "lib"] as const;

/**
 * There is no exemption list here any more, and that is the finding.
 *
 * There was one, of six entries, each carrying the sentence that said what
 * closing it would take — and every sentence turned out to be right. The sixth
 * was `lib/deep-link.ts`, "needs a module mock", closed an hour later by
 * exactly that. The fifth said "needs the mount harness" and
 * `lib/nav-animation-context.tsx` took `providerHarness` and no mocks at all.
 * The third and fourth were hiding bugs rather than gaps:
 * `lib/use-visibility-refresh.ts` returned an empty cleanup over a running
 * interval, and `lib/use-reactions.ts` kept a reaction the server had refused.
 *
 * The last two went together, and not by choice. `components/DraggableList.web
 * .tsx` is the shim the deployed web bundle serves and wanted a render
 * harness; `components/DraggableList.tsx` is seven lines of re-export with no
 * behaviour to assert. But {@link namedBySomeSuite} counts a module as named
 * when a suite contains its path without the extension, and the web spelling
 * CONTAINS the native one — so `draggable-list-web.test.ts` could not name the
 * half it tests without naming the half it does not. It answers for both
 * deliberately: the parity cases there hold the native file to still being
 * nothing but re-exports, which is the claim its exemption comment made and
 * nothing checked.
 *
 * `assertExemptionsHonest` refuses an empty list ("delete it instead"), which
 * is why this is prose rather than a `{}`. Re-adding the list is the right
 * move for a module that genuinely cannot be reached yet — with the sentence
 * saying what it would take, because that sentence is what closed six of six.
 */

/**
 * This file's own name in the suite walk, asked of the runtime.
 *
 * `import.meta.url` rather than the literal, the spelling
 * `header-prose-names.test.ts` and `suite-files-helper.test.ts` already use: a
 * filename typed into the file it names survives a rename as a constant
 * pointing at nothing, and the exclusion it drives stops excluding anything
 * without a single case going red.
 */
const SELF = path.basename(new URL(import.meta.url).pathname);

/** `lib/use-now.ts` → `lib/use-now`, the form an import specifier ends with. */
function stemOf(relative: string): string {
  return relative.replace(/\.tsx?$/, "");
}

/** `lib/use-now.ts` → `use-now.ts`, the form a split path argument carries. */
function fileNameOf(relative: string): string {
  return relative.slice(relative.lastIndexOf("/") + 1);
}

/** Every suite's code, comments stripped, this file left out. */
const SUITE_CODE: readonly string[] = suiteFiles()
  .filter((relative) => relative !== SELF)
  .map((relative) => suiteCode(relative));

/** The modules the census is about. */
const MODULES: readonly string[] = sourceFiles(...APP_TREE);

/** True when some suite's code carries either spelling of this module. */
function namedBySomeSuite(relative: string): boolean {
  const stem = stemOf(relative);
  const fileName = fileNameOf(relative);
  return SUITE_CODE.some((code) => code.includes(stem) || code.includes(fileName));
}

describe("every module in the app tree is named by a suite", () => {
  it("leaves no module that nothing has ever named", () => {
    const offenders = MODULES.filter((relative) => !namedBySomeSuite(relative));
    assert.deepEqual(
      offenders,
      [],
      `no suite names these modules:\n  ${offenders.join("\n  ")}\nA module nothing has ever imported, read or swept is one nobody has decided about — write the suite, or re-add the exemption list this file describes with the sentence that says what closing the entry would take`,
    );
  });

  it("reaches no module only through a file name another module shares", () => {
    // The loose half of the rule, measured rather than argued about. A second
    // `helpers.ts` in a second directory would put an entry here, and the entry
    // is a module whose evidence of being tested is a mention of a DIFFERENT
    // file — which reads exactly like coverage and is not.
    const perFileName = new Map<string, number>();
    for (const relative of MODULES) {
      const fileName = fileNameOf(relative);
      perFileName.set(fileName, (perFileName.get(fileName) ?? 0) + 1);
    }
    const ambiguous = MODULES.filter((relative) => {
      if ((perFileName.get(fileNameOf(relative)) ?? 0) < 2) return false;
      const stem = stemOf(relative);
      return !SUITE_CODE.some((code) => code.includes(stem));
    });
    assert.deepEqual(
      ambiguous,
      [],
      `these modules are counted as named only because a suite mentions a file with the same name:\n  ${ambiguous.join("\n  ")}\nThe evidence points at a different module — name the path, not the file`,
    );
  });

  it("walks enough of the tree, and reads enough suites, to mean something", () => {
    // Both floors are measured, and both guard the same failure: a walk that
    // returns nothing agrees that nothing is unnamed. The suite floor is the
    // one that would go first — `SELF` filtering the whole list, a reader
    // renamed — and it is the one whose failure looks most like a pass.
    assert.ok(
      MODULES.length >= 200,
      measuredFloor(MODULES.length, 200, "module(s) in the app tree"),
    );
    assert.ok(
      SUITE_CODE.length >= 400,
      measuredFloor(SUITE_CODE.length, 400, "suite(s) read for module names"),
    );
    assert.equal(
      SUITE_CODE.length,
      suiteFiles().length - 1,
      `${SELF} left ${suiteFiles().length - SUITE_CODE.length} suites out of the index instead of one — the exclusion is this file and nothing else, and a wider one makes the census read clean`,
    );
  });
});
