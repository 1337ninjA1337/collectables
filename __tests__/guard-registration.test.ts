/**
 * Every registry a new guard has to join, in one failure instead of four.
 *
 * WHAT THIS COSTS TODAY. Landing `lint:reporter-graph` and then
 * `lint:comment-terminators` took four red runs each, one per registry, in this
 * order and only because that is the order the suites happened to fail in: a
 * missing `SCANNED_FLOORS` entry, then a missing partial-root fixture, then a
 * missing `GUARD_SCANS` entry, then a missing planted-offender case. Each
 * message was clear and each arrived alone, so the checklist exists only as a
 * SEQUENCE OF FAILURES — you learn the fourth item by fixing the third. The
 * suites run concurrently, so the order is not even stable.
 *
 * WHAT THIS FILE ADDS, and what it deliberately does not. It does not replace
 * any of those assertions: each one knows things this cannot, and each one's
 * message is better than a list. It answers a different question — "which
 * registries does THIS guard still need an entry in" — and answers all of it at
 * once, before the first specific failure is fixed.
 *
 * HOW MEMBERSHIP IS DECIDED. Not every guard belongs in every registry: a guard
 * that reads two named files has no scan list and no walk whose base could be
 * wrong. So each registry carries the CONDITION under which a guard must appear
 * in it, and the conditions are read off the guard's own wrapper — the same
 * predicates the owning suites use, deliberately duplicated rather than shared,
 * because a shared predicate that drifted would take both the specific check and
 * this one with it.
 *
 * The registries are read as TEXT rather than imported. They are consts inside
 * `*.test.ts` files, and importing one would register that suite's `describe`
 * blocks a second time under this file's name. Text is also the right question:
 * a guard named in an exemption list has been DECIDED about, which is what this
 * file is asking, and a stricter check would have to know each registry's
 * escape hatches and would go stale as they changed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LINT_GUARDS } from "../lib/lint-guards";
import { SCANNED_FLOORS } from "../lib/scanned-floor";
import { checkNameOf } from "./helpers/guard-fixture";
import { readRepoFile as read } from "./helpers/repo-file";
import { SUITES_REL } from "./helpers/suite-files";

/** One place a guard has to be registered, and who has to be. */
interface Registry {
  /** Where the entry goes, as a reader would look for it. */
  readonly where: string;
  /** The suite (or module) whose source is searched for the guard's name. */
  readonly file: readonly string[];
  /** True when this guard needs an entry here. */
  readonly applies: (wrapper: string, checkName: string) => boolean;
  /** What the entry is for, in the failure message. */
  readonly why: string;
}

const REGISTRIES: readonly Registry[] = [
  {
    where: "SCANNED_FLOORS in lib/scanned-floor.ts",
    file: ["lib", "scanned-floor.ts"],
    applies: () => true,
    why: "every guard commits a measured floor or a declared input list, so a run that examined nothing refuses instead of passing",
  },
  {
    where: "PARTIAL_FIXTURES or NO_REACHABLE_COUNT in __tests__/lint-guard-partial-root.test.ts",
    file: [SUITES_REL, "lint-guard-partial-root.test.ts"],
    applies: () => true,
    why: "a count floor with no red run is a number nobody has ever seen fail; a guard with no reachable count says so instead",
  },
  {
    where: "GUARD_SCANS in __tests__/guard-scan-dirs.test.ts",
    file: [SUITES_REL, "guard-scan-dirs.test.ts"],
    applies: (wrapper) => /const SCANNED_DIRS = \[/.test(wrapper),
    why: "a guard that declares a scan list has to say which source directories it skips and why, or the list narrows silently",
  },
  {
    where: "PLANTED (or its two exemption lists) in __tests__/guard-report-paths.test.ts",
    file: [SUITES_REL, "guard-report-paths.test.ts"],
    applies: (wrapper) => /\blistSourceFiles\(/.test(wrapper),
    why: "a guard walking through the shared source walk reports paths relative to a root, and the base is exactly what it can get wrong",
  },
  {
    where: "EMPTY_INPUT_FIXTURES in __tests__/lint-guard-empty-input.test.ts",
    file: [SUITES_REL, "lint-guard-empty-input.test.ts"],
    applies: (_wrapper, checkName) => Boolean(SCANNED_FLOORS[checkName]?.inputs),
    why: "a declared input that reads fine and carries nothing has to be named as the cause, not left to the consequences of it being empty",
  },
];

/** Every registry this guard needs an entry in but is not named in. */
function missingFor(checkName: string, wrapper: string): string[] {
  return REGISTRIES.filter((registry) => {
    if (!registry.applies(wrapper, checkName)) return false;
    return !read(...(registry.file as [string, ...string[]])).includes(checkName);
  }).map((registry) => `${registry.where} — ${registry.why}`);
}

describe("a new guard is told every registry it still has to join", () => {
  const guards = LINT_GUARDS.map((guard) => {
    const checkName = checkNameOf(guard.scriptPath);
    return { guard, checkName, wrapper: read(guard.scriptPath) };
  });

  it("names every gap for every guard at once, rather than one per run", () => {
    const gaps: string[] = [];
    for (const { guard, checkName, wrapper } of guards) {
      for (const missing of missingFor(checkName, wrapper)) {
        gaps.push(`${guard.npmScript} (${checkName}) is missing from ${missing}`);
      }
    }
    assert.deepEqual(gaps, [], `\n${gaps.join("\n")}\n`);
  });

  it("finds a real registry list rather than an empty one", () => {
    // The hazard every sweep here has, applied to this one: a table that
    // stopped resolving would report "nothing missing" perfectly.
    assert.ok(REGISTRIES.length >= 5, `only ${REGISTRIES.length} registries listed`);
    assert.ok(LINT_GUARDS.length >= 12, `only ${LINT_GUARDS.length} guards in the registry`);
  });

  it("points at files that exist, so a rename fails here rather than going quiet", () => {
    // A registry whose file moved would satisfy every membership check by
    // throwing — or, worse, by never being read. Reading each one up front
    // turns that into this case rather than into a silent pass.
    for (const registry of REGISTRIES) {
      assert.doesNotThrow(
        () => read(...(registry.file as [string, ...string[]])),
        `${registry.where} names a file that cannot be read`,
      );
    }
  });

  it("keeps at least one registry that only some guards belong to", () => {
    // If every condition were `() => true` this file would say nothing about
    // WHICH guards need what — it would be five copies of "is it mentioned
    // anywhere". The conditional ones are what make the answer specific.
    const conditional = REGISTRIES.filter((registry) => {
      const alwaysTrue = guards.every(({ checkName, wrapper }) =>
        registry.applies(wrapper, checkName),
      );
      return !alwaysTrue;
    });
    assert.ok(
      conditional.length >= 2,
      "every registry now applies to every guard, so the conditions have stopped distinguishing anything",
    );
  });

  it("agrees with the owning suites about who is exempt", () => {
    // The one case that would catch this file drifting into a rule of its own:
    // a guard this file says needs no entry, that the owning suite would demand
    // one from. Checked where the disagreement is cheapest to see — the two
    // registries with a source-shaped condition.
    for (const { checkName, wrapper } of guards) {
      const walks = /\blistSourceFiles\(/.test(wrapper);
      const declaresDirs = /const SCANNED_DIRS = \[/.test(wrapper);
      assert.ok(
        !declaresDirs || walks,
        `${checkName} declares SCANNED_DIRS without calling listSourceFiles — guard-scan-dirs.test.ts requires both, so one of the two conditions here is wrong`,
      );
    }
  });
});
