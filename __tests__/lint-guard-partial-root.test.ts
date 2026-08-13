/**
 * The QUIET failure, for every guard whose premise is a count.
 *
 * `__tests__/lint-guard-empty-root.test.ts` points all twelve guards at an
 * empty directory and reads twelve refusals — all of them `no_files`, the code
 * `evaluateScannedFloor` returned before any floor existed. The number in
 * `SCANNED_FLOORS` does not buy that refusal. It buys the other one: a walk
 * that lost `app/` but kept `lib/` finds real files, finds too few of them,
 * and reports a comfortable-looking count over a fraction of the tree. Until
 * this file, `below_floor` had only ever been produced by hand-editing a
 * script and reverting it.
 *
 * The fixture is the empty root plus one part of this repository copied into
 * it (`__tests__/helpers/guard-fixture.ts`), so each guard walks something
 * real and comes up short. Registry-driven: every `LINT_GUARDS` entry either
 * has a partial fixture here or is listed in `NO_REACHABLE_COUNT` with the
 * reason no tree can lower its count — a new count-shaped guard cannot land
 * without one or the other.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { LINT_GUARDS } from "../lib/lint-guards";
import { SCANNED_FLOORS } from "../lib/scanned-floor";
import {
  assertNoStackTrace,
  checkNameOf,
  makePartialRoot,
  runGuardIn,
  type PartialRoot,
} from "./helpers/guard-fixture";

const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * The first `take` repo-relative entries of a directory, sorted — so a fixture
 * names "two of the migrations" rather than two filenames that a rename turns
 * into a `no_files` run wearing a `below_floor` test's name.
 */
function firstEntriesOf(
  relativeDir: string,
  take: number,
  filter: (name: string) => boolean = () => true,
): string[] {
  const names = fs
    .readdirSync(path.join(REPO_ROOT, relativeDir))
    .filter(filter)
    .sort()
    .slice(0, take);
  assert.ok(
    names.length === take,
    `${relativeDir} holds ${names.length} matching entries, too few to build a partial fixture from`,
  );
  return names.map((name) => `${relativeDir}/${name}`);
}

/**
 * What each count-shaped guard gets pointed at. Every spec is a STRICT subset
 * of what the guard normally walks: enough to clear zero, far short of the
 * floor. The assertions read the count out of the guard's own message rather
 * than pinning it, so ordinary churn in these directories cannot fail the
 * suite — only a fixture that stopped being partial can.
 */
const PARTIAL_FIXTURES: Readonly<Record<string, () => string[]>> = {
  // Walks app + components + lib; app alone is the smallest of the three.
  "check-inline-hex": () => ["app"],
  // Both walk app + components.
  "check-inline-radius": () => ["app"],
  "check-analytics-imports": () => ["app"],
  // Same walk, .tsx only.
  "check-clarity-input-mask": () => ["app"],
  // Walks the whole tree; app/ is a few dozen of the several hundred files.
  "check-secrets": () => ["app"],
  // Walks lib/*-config.ts — five files, floor of three, so the fixture is two.
  "check-env-inlining": () =>
    firstEntriesOf("lib", 2, (name) => name.endsWith("-config.ts")),
  // Both walk supabase/migrations and read MANUAL-TASKS.md beside it. The
  // doc has to come along or the run fails on the input half first, which is
  // the empty-root test's assertion, not this one's.
  "check-migration-docs": () => [
    ...firstEntriesOf("supabase/migrations", 2),
    "MANUAL-TASKS.md",
  ],
  "check-supabase-migration-naming": () => [
    ...firstEntriesOf("supabase/migrations", 2),
    "MANUAL-TASKS.md",
  ],
};

/**
 * Guards no partial tree can push below their floor, with the reason. Three of
 * them declare no count at all; the fourth counts something that is not on
 * disk.
 */
const NO_REACHABLE_COUNT: Readonly<Record<string, string>> = {
  "check-appstore-config":
    "inputs-shaped — reads one fixed app.json, so there is no count to shrink",
  "check-sentry-version":
    "inputs-shaped — reads package.json and package-lock.json by name",
  "check-privacy-baseline-provenance":
    "delegates its premise to evaluatePrivacyBaselineProvenance's checked === 0 refusal",
  "generate-powerbi-schema-doc":
    "counts ANALYTICS_EVENTS, which is imported TypeScript rather than a walk of the scan root — no fixture on disk can lower it, and its inputs half is covered by the empty-root harness",
};

/** One temp root per distinct spec, built on demand and reused. */
const fixtures = new Map<string, PartialRoot>();

function fixtureFor(entries: readonly string[]): PartialRoot {
  const key = entries.join("|");
  const existing = fixtures.get(key);
  if (existing) return existing;
  const made = makePartialRoot(entries);
  fixtures.set(key, made);
  return made;
}

after(() => {
  for (const fixture of fixtures.values()) fixture.cleanup();
  fixtures.clear();
});

/** The `below_floor` line, parsed back into the two numbers it carries. */
function parseBelowFloor(
  checkName: string,
  output: string,
): { count: number; minimum: number; label: string } {
  const match = output.match(
    new RegExp(
      `${checkName}: ERROR — scanned (\\d+) (.+?)\\(s\\), below the committed floor of (\\d+)`,
    ),
  );
  assert.ok(
    match,
    `${checkName} did not report below_floor against a partial root:\n${output}`,
  );
  return {
    count: Number(match[1]),
    label: match[2],
    minimum: Number(match[3]),
  };
}

describe("every count-shaped guard refuses a partial scan root", () => {
  for (const guard of LINT_GUARDS) {
    const checkName = checkNameOf(guard.scriptPath);
    const spec = PARTIAL_FIXTURES[checkName];
    if (!spec) continue;

    const run = () => runGuardIn(guard, fixtureFor(spec()).root);

    describe(guard.npmScript, () => {
      it("exits 1 over a tree that holds only part of its walk", () => {
        assert.equal(
          run().status,
          1,
          `${guard.npmScript} passed over a fraction of its scan roots — the quiet failure the floor exists for:\n${run().output}`,
        );
      });

      it("fails on below_floor, not on the empty-root code beside it", () => {
        const { output } = run();
        const { count } = parseBelowFloor(checkName, output);
        assert.ok(
          count > 0,
          `${guard.npmScript} scanned 0 files, so this fixture reproduces no_files — the code the empty-root harness already covers — and says nothing about the floor:\n${output}`,
        );
      });

      it("quotes the count it actually reached, below the committed floor", () => {
        const { count, minimum } = parseBelowFloor(checkName, run().output);
        assert.ok(
          count < minimum,
          `${guard.npmScript} reported ${count} against a floor of ${minimum}, which is not below it`,
        );
      });

      it("quotes the registry's floor, not a number of its own", () => {
        const { minimum, label } = parseBelowFloor(checkName, run().output);
        const floor = SCANNED_FLOORS[checkName]?.count;
        assert.ok(floor, `${checkName} declares no count floor`);
        assert.equal(minimum, floor.minimum);
        assert.equal(label, floor.label);
      });

      it("prints no stack trace — a premise failure is a result, not a crash", () => {
        assertNoStackTrace(run().output, guard.npmScript);
      });
    });
  }

  it("covers every guard the registry declares a count floor for", () => {
    for (const guard of LINT_GUARDS) {
      const checkName = checkNameOf(guard.scriptPath);
      if (PARTIAL_FIXTURES[checkName]) continue;
      assert.ok(
        NO_REACHABLE_COUNT[checkName],
        `${guard.npmScript} has neither a partial fixture nor a stated reason it cannot have one — a count floor with no red run is a number nobody has ever seen fail`,
      );
    }
  });

  it("exempts nothing that a fixture could actually reach", () => {
    for (const [checkName, reason] of Object.entries(NO_REACHABLE_COUNT)) {
      assert.ok(
        reason.length > 0,
        `${checkName} is exempt without a reason`,
      );
      assert.ok(
        !PARTIAL_FIXTURES[checkName],
        `${checkName} is both exempt and covered — one of the two is wrong`,
      );
    }
  });

  it("names only guards that exist, on both lists", () => {
    const registered = new Set(LINT_GUARDS.map((g) => checkNameOf(g.scriptPath)));
    for (const checkName of [
      ...Object.keys(PARTIAL_FIXTURES),
      ...Object.keys(NO_REACHABLE_COUNT),
    ]) {
      assert.ok(
        registered.has(checkName),
        `${checkName} is not in LINT_GUARDS`,
      );
    }
  });
});

/**
 * Each floor's own claim, checked against the tree rather than against prose.
 *
 * `check-inline-hex` walks three roots and its floor was 150 — the exact
 * number of `.ts`/`.tsx` files in `lib/`. A walk that lost BOTH `app/` and
 * `components/` therefore passed, at the boundary, while the note in
 * `SCANNED_FLOORS` claimed it would fail. Nothing was wrong when that number
 * was measured; the tree grew out from under it, silently, which is the exact
 * decay these floors exist to catch one level down.
 *
 * The property below is the one a partial root can enforce for a multi-root
 * walk: NO single scan root, on its own, clears the floor. It holds for all
 * four of these today (`components/` sits one file under the 45 that three of
 * them share), and when a root grows past its floor this test goes red in CI
 * and says to re-measure — instead of the floor quietly meaning less each
 * time someone adds a file.
 */
const SINGLE_ROOT_LOCKS: Readonly<Record<string, readonly string[]>> = {
  "check-inline-hex": ["app", "components", "lib"],
  "check-inline-radius": ["app", "components"],
  "check-analytics-imports": ["app", "components"],
  "check-clarity-input-mask": ["app", "components"],
};

/** The count out of a guard's report, whether it passed or hit its floor. */
function parseScanned(output: string): number {
  const match = output.match(/scanned (\d+) /);
  assert.ok(match, `no scan count in the guard's report:\n${output}`);
  return Number(match[1]);
}

describe("no single scan root clears a multi-root guard's floor", () => {
  for (const [checkName, roots] of Object.entries(SINGLE_ROOT_LOCKS)) {
    const guard = LINT_GUARDS.find(
      (g) => checkNameOf(g.scriptPath) === checkName,
    );
    assert.ok(guard, `${checkName} is not in LINT_GUARDS`);

    describe(guard.npmScript, () => {
      it("still walks exactly the roots these fixtures are built from", () => {
        // The three wrappers spell the constant three different ways
        // (SCAN_ROOTS / SCANNED_DIRS / SCAN_DIRS), so pin the literal rather
        // than the name — a root added or dropped here must fail loudly,
        // because the fixtures below stop meaning anything the moment the
        // walk covers something they do not.
        const source = fs.readFileSync(
          path.join(REPO_ROOT, "scripts", `${checkName}.ts`),
          "utf8",
        );
        assert.match(
          source,
          new RegExp(`\\[${roots.map((r) => `"${r}"`).join(", ")}\\]`),
          `${checkName}'s scan roots moved; update SINGLE_ROOT_LOCKS to match`,
        );
      });

      for (const root of roots) {
        it(`refuses a tree holding only ${root}/`, () => {
          const run = runGuardIn(guard, fixtureFor([root]).root);
          const floor = SCANNED_FLOORS[checkName].count;
          assert.ok(floor, `${checkName} declares no count floor`);
          assert.equal(
            run.status,
            1,
            `${root}/ alone holds ${parseScanned(run.output)} of the ${floor.label}s ${checkName} counts, which clears its floor of ${floor.minimum} — so every other scan root can vanish and the guard still reports green. Re-measure the floor in lib/scanned-floor.ts and say why in the commit.\n${run.output}`,
          );
          const { count } = parseBelowFloor(checkName, run.output);
          assert.ok(count > 0, `${root}/ contributed nothing to the walk`);
        });
      }
    });
  }
});
