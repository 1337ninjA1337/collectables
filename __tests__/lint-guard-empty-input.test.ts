/**
 * The failure code no wrapper had ever produced.
 *
 * `lib/scanned-floor.ts` declares six ways a guard's premise can fail. The
 * empty-root harness produces `no_files` (and `unreadable_input`, for the
 * guards that read fixed files by name); the partial-root harness produces
 * `below_floor`. `empty_input` — the one the `inputs` half of the table exists
 * for — was reachable only from a unit test of the pure function.
 *
 * It is the interesting one precisely because nothing crashes. A declared
 * input that reads fine, parses fine and carries `{}` sends every downstream
 * check looking through an empty object: `check-appstore-config` then reports
 * nine missing keys, which is a loud failure ABOUT THE WRONG THING — it reads
 * as "app.json lost its identifiers" when the truth is "app.json is not there
 * in any useful sense". Nine consequences of one cause, and the cause never
 * named.
 *
 * No path in this repository is that file, so the fixture writes one:
 * `makePartialRoot(entries, files)` puts literal content into the scratch root
 * beside the copies. Registry-driven, per INPUT rather than per guard — every
 * name in every `SCANNED_FLOORS` entry's `inputs` must have a fixture of its
 * own below, so a guard cannot grow a declared input without a run that proves
 * the declaration does something.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { LINT_GUARDS } from "../lib/lint-guards";
import { SCANNED_FLOORS } from "../lib/scanned-floor";
import {
  assertNoStackTrace,
  checkNameOf,
  makePartialRoot,
  runGuardIn,
  type PartialRoot,
} from "./helpers/guard-fixture";

type EmptyInputFixture = {
  /** Repo-relative paths copied in, for guards whose count floor asserts first. */
  readonly entries?: readonly string[];
  /** Literal files written into the scratch root — the empty inputs. */
  readonly files: Readonly<Record<string, string>>;
  /** Which declared input the guard should name, given this fixture. */
  readonly expect: string;
};

/**
 * One fixture per DECLARED INPUT, not per guard.
 *
 * `evaluateParsedInputs` returns on the first failure, so a fixture that
 * empties every input at once only ever exercises the first name in the list.
 * `check-sentry-version` declares two and its lockfile half had no run at all:
 * a wrapper that stopped passing `package-lock.json` would still fail this
 * suite on `package.json` and look covered. The fix is the general one — each
 * declared input gets a fixture where IT is the empty one and everything
 * beside it reads fine — and the coverage assertion below is over inputs
 * rather than over guards, so the next multi-input guard cannot repeat it.
 *
 * `{}` and `"   "` are both "read fine, carry nothing" — `isNonEmptyInput`
 * treats an object with no keys and a whitespace-only string the same way, and
 * both are what a truncated or half-written file actually looks like.
 */
const EMPTY_INPUT_FIXTURES: Readonly<
  Record<string, readonly EmptyInputFixture[]>
> = {
  "check-appstore-config": [
    { files: { "app.json": "{}" }, expect: "app.json" },
  ],
  "check-sentry-version": [
    {
      // The lockfile is real, so the manifest is the only thing left to name.
      entries: ["package-lock.json"],
      files: { "package.json": "{}" },
      expect: "package.json",
    },
    {
      // ...and the mirror image, which is the run this guard never had.
      entries: ["package.json"],
      files: { "package-lock.json": "{}" },
      expect: "package-lock.json",
    },
  ],
  "check-migration-docs": [
    {
      // The count floor asserts BEFORE the input check in this wrapper, so the
      // migrations have to come along or the run fails on the other code.
      entries: ["supabase/migrations"],
      files: { "MANUAL-TASKS.md": "   \n" },
      expect: "MANUAL-TASKS.md",
    },
  ],
  "check-supabase-migration-naming": [
    {
      entries: ["supabase/migrations"],
      files: { "MANUAL-TASKS.md": "   \n" },
      expect: "MANUAL-TASKS.md",
    },
  ],
  "generate-powerbi-schema-doc": [
    {
      // Counts ANALYTICS_EVENTS, which is imported rather than walked, so the
      // count half clears itself and the input half is what speaks.
      files: { "docs/powerbi-connection.md": "" },
      expect: "docs/powerbi-connection.md",
    },
  ],
};

const fixtures: PartialRoot[] = [];

after(() => {
  for (const fixture of fixtures) fixture.cleanup();
  fixtures.length = 0;
});

const rootFor = (fixture: EmptyInputFixture): string => {
  const made = makePartialRoot(fixture.entries ?? [], fixture.files);
  fixtures.push(made);
  return made.root;
};

describe("every declared input gets a run where it reads fine and says nothing", () => {
  for (const guard of LINT_GUARDS) {
    const checkName = checkNameOf(guard.scriptPath);
    const guardFixtures = EMPTY_INPUT_FIXTURES[checkName] ?? [];

    for (const fixture of guardFixtures) {
      let cached: ReturnType<typeof runGuardIn> | undefined;
      const run = () => (cached ??= runGuardIn(guard, rootFor(fixture)));

      describe(`${guard.npmScript} (${fixture.expect})`, () => {
        it("exits 1 on an input it could read and that carries nothing", () => {
          assert.equal(
            run().status,
            1,
            `${guard.npmScript} accepted an empty ${fixture.expect}:\n${run().output}`,
          );
        });

        it("names the input, not the consequences of it being empty", () => {
          assert.match(
            run().output,
            new RegExp(
              `${checkName}: ERROR — input "${fixture.expect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" is empty`,
            ),
            `${guard.npmScript} failed without naming the empty input — the whole point is that the cause is said once instead of its consequences being listed:\n${run().output}`,
          );
        });

        it("is empty_input, not the missing or unreadable code beside it", () => {
          // All three are about a declared input and only one of them means
          // "the file is there and useless"; conflating them sends the reader
          // hunting for a moved file or a wiring bug.
          const { output } = run();
          assert.doesNotMatch(output, /could not be read/);
          assert.doesNotMatch(output, /was never handed to the floor check/);
        });

        it("names an input the registry actually declares", () => {
          const declared = SCANNED_FLOORS[checkName]?.inputs;
          assert.ok(declared, `${checkName} declares no fixed inputs`);
          assert.ok(
            declared.includes(fixture.expect),
            `${fixture.expect} is not one of ${checkName}'s declared inputs (${declared.join(", ")})`,
          );
        });

        it("prints no stack trace — a premise failure is a result, not a crash", () => {
          assertNoStackTrace(run().output, guard.npmScript);
        });
      });
    }
  }

  it("covers every DECLARED INPUT, not merely every guard that declares one", () => {
    // Per-input, because evaluateParsedInputs returns on the first failure:
    // a guard with two inputs and one fixture proves nothing about the second.
    for (const guard of LINT_GUARDS) {
      const checkName = checkNameOf(guard.scriptPath);
      const declared = SCANNED_FLOORS[checkName]?.inputs;
      if (!declared) continue;
      const named = new Set(
        (EMPTY_INPUT_FIXTURES[checkName] ?? []).map((f) => f.expect),
      );
      for (const input of declared) {
        assert.ok(
          named.has(input),
          `${guard.npmScript} declares "${input}" with no empty-input run of its own — the wrapper could stop handing it over and this suite would still pass on another input's name`,
        );
      }
    }
  });

  it("writes a fixture only for a guard that declares inputs", () => {
    for (const checkName of Object.keys(EMPTY_INPUT_FIXTURES)) {
      assert.ok(
        SCANNED_FLOORS[checkName]?.inputs,
        `${checkName} has an empty-input fixture but declares no inputs`,
      );
    }
  });

  it("empties exactly one declared input per fixture", () => {
    // A fixture that blanks two at once tests whichever the wrapper happens
    // to check first, and silently stops testing the other if that order
    // changes — the failure mode this whole per-input split exists to remove.
    for (const [checkName, guardFixtures] of Object.entries(
      EMPTY_INPUT_FIXTURES,
    )) {
      const declared = SCANNED_FLOORS[checkName]?.inputs ?? [];
      for (const fixture of guardFixtures) {
        const blanked = Object.keys(fixture.files).filter((f) =>
          declared.includes(f),
        );
        assert.deepEqual(
          blanked,
          [fixture.expect],
          `${checkName} fixture for "${fixture.expect}" writes ${blanked.length} empty declared input(s)`,
        );
      }
    }
  });
});

describe("the fixture writer itself", () => {
  it("refuses a spec with neither copies nor literals", () => {
    // That is the empty root, which asserts a different code entirely.
    assert.throws(() => makePartialRoot([], {}), /is an EMPTY root/);
  });

  it("refuses an absolute literal path that would escape the scratch root", () => {
    assert.throws(
      () => makePartialRoot([], { "/etc/passwd": "" }),
      /must be a path inside the scratch root/,
    );
  });
});
