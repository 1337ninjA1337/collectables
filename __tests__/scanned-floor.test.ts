import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_SCANNED_LABEL,
  SCANNED_FLOORS,
  ScannedFloorError,
  assertParsedInputs,
  assertScanned,
  assertScannedFloor,
  countFloorFor,
  evaluateParsedInputs,
  evaluateScannedFloor,
  formatScannedFloorFailure,
  formatScannedFloorProblem,
  isNonEmptyInput,
  isUnreadableInput,
  scannedFloorFor,
  unreadableInput,
  validateScannedFloorEntry,
  validateScannedFloors,
  type ScannedFloor,
  type ScannedFloorProblemCode,
} from "../lib/scanned-floor";
import { LINT_GUARDS } from "../lib/lint-guards";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const failureOf = (count: number, minimum: number, label?: string) => {
  const verdict = evaluateScannedFloor(count, minimum, label);
  assert.equal(verdict.ok, false, `expected ${count}/${minimum} to fail`);
  if (verdict.ok) throw new Error("unreachable");
  return verdict.failure;
};

describe("evaluateScannedFloor", () => {
  it("passes when the count meets the floor exactly", () => {
    assert.deepEqual(evaluateScannedFloor(150, 150), { ok: true });
  });

  it("passes when the count is comfortably above the floor", () => {
    assert.deepEqual(evaluateScannedFloor(211, 150), { ok: true });
  });

  it("fails an empty walk with no_files — the loud version", () => {
    const failure = failureOf(0, 150);
    assert.equal(failure.code, "no_files");
    assert.equal(failure.count, 0);
    assert.equal(failure.minimum, 150);
  });

  it("fails a walk of one with no_files rather than below_floor when the floor is 1", () => {
    // A floor of 1 is only ever "> 0"; the count that trips it is zero.
    assert.deepEqual(evaluateScannedFloor(1, 1), { ok: true });
    assert.equal(failureOf(0, 1).code, "no_files");
  });

  it("fails a shrunken walk with below_floor — the QUIET version", () => {
    // This is the case `count > 0` misses: a walk that lost a source root
    // still reports a number, and the number still looks like a scan.
    const failure = failureOf(3, 150);
    assert.equal(failure.code, "below_floor");
    assert.equal(failure.count, 3);
  });

  it("rejects a floor of 0 as invalid_floor, not as a pass", () => {
    // A zero floor would green-light an empty walk while looking covered.
    const failure = failureOf(0, 0);
    assert.equal(failure.code, "invalid_floor");
  });

  it("rejects a negative or fractional floor", () => {
    assert.equal(failureOf(10, -1).code, "invalid_floor");
    assert.equal(failureOf(10, 1.5).code, "invalid_floor");
  });

  it("reports invalid_floor ahead of the count so the caller bug wins", () => {
    // Count 500 would sail past any sane floor; the bogus floor still fails.
    assert.equal(failureOf(500, 0).code, "invalid_floor");
  });

  it("treats a negative count as no_files", () => {
    assert.equal(failureOf(-4, 10).code, "no_files");
  });

  it("carries the caller's label, defaulting when none is given", () => {
    assert.equal(failureOf(0, 5).label, DEFAULT_SCANNED_LABEL);
    assert.equal(failureOf(0, 5, "source file").label, "source file");
  });
});

describe("formatScannedFloorFailure", () => {
  it("names the guard, the count and the floor on a below_floor line", () => {
    const line = formatScannedFloorFailure(
      "check-inline-hex",
      failureOf(3, 150, "source file"),
    );
    assert.match(line, /^check-inline-hex: ERROR — /);
    assert.match(line, /scanned 3 source file\(s\)/);
    assert.match(line, /floor of 150/);
  });

  it("says a pass over zero is not a pass on a no_files line", () => {
    const line = formatScannedFloorFailure("check-secrets", failureOf(0, 500));
    assert.match(line, /a pass over zero files is not a pass/);
    assert.match(line, /at least 500/);
  });

  it("explains why a floor below 1 is itself the bug", () => {
    const line = formatScannedFloorFailure("check-secrets", failureOf(9, 0));
    assert.match(line, /floor of 0 is not a positive integer/);
    assert.match(line, /passes over an empty walk/);
  });

  it("points at the file the number lives in when the number is the thing to change", () => {
    for (const failure of [failureOf(2, 5), failureOf(2, 0)]) {
      const line = formatScannedFloorFailure("some-check", failure);
      assert.match(line, /lib\/scanned-floor\.ts/);
    }
  });

  it("points a no_files failure at the WALK, not at the floor", () => {
    // Nothing found is a broken scan root, not a number that needs
    // re-measuring — sending the reader to edit the floor is how a floor
    // gets lowered to whatever the broken walk happens to return.
    const line = formatScannedFloorFailure("some-check", failureOf(0, 5));
    assert.match(line, /scan roots/);
    assert.doesNotMatch(line, /re-measure/);
  });
});

describe("assertScanned", () => {
  it("returns silently when the floor is met", () => {
    assert.doesNotThrow(() => assertScanned("check-inline-hex", 211, 150));
  });

  it("throws a ScannedFloorError carrying the formatted message", () => {
    assert.throws(
      () => assertScanned("check-inline-hex", 0, 150, "source file"),
      (error: unknown) => {
        assert.ok(error instanceof ScannedFloorError);
        assert.equal(error.checkName, "check-inline-hex");
        assert.equal(error.failure.code, "no_files");
        assert.equal(
          error.message,
          formatScannedFloorFailure("check-inline-hex", error.failure),
        );
        return true;
      },
    );
  });

  it("is an Error subclass, so an unhandled one still reads as a failure", () => {
    const error = new ScannedFloorError("x", failureOf(0, 2));
    assert.ok(error instanceof Error);
    assert.equal(error.name, "ScannedFloorError");
  });
});

describe("isNonEmptyInput", () => {
  it("rejects the shapes a file that read fine can still parse to", () => {
    for (const empty of [null, undefined, "", "   ", [], {}]) {
      assert.equal(isNonEmptyInput(empty), false, JSON.stringify(empty) ?? "undefined");
    }
  });

  it("accepts anything carrying content, including falsy scalars", () => {
    // A number or boolean cannot be "empty" — presence is the whole question,
    // and treating 0 as empty would reject a legitimately-zero reading.
    for (const full of [0, false, "x", [1], { a: 1 }]) {
      assert.equal(isNonEmptyInput(full), true, JSON.stringify(full));
    }
  });
});

describe("evaluateParsedInputs", () => {
  it("passes when every declared input is present and non-empty", () => {
    assert.deepEqual(
      evaluateParsedInputs(["a.json", "b.json"], { "a.json": { x: 1 }, "b.json": "text" }),
      { ok: true },
    );
  });

  it("ignores undeclared extras — the table names the minimum, not the maximum", () => {
    assert.deepEqual(
      evaluateParsedInputs(["a.json"], { "a.json": { x: 1 }, "z.json": {} }),
      { ok: true },
    );
  });

  it("fails a declared input the wrapper never handed over", () => {
    const verdict = evaluateParsedInputs(["a.json", "b.json"], { "a.json": { x: 1 } });
    assert.equal(verdict.ok, false);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.failure.code, "missing_input");
    assert.equal(verdict.failure.input, "b.json");
  });

  it("fails an input that parsed to nothing — the quiet case for fixed readers", () => {
    const verdict = evaluateParsedInputs(["app.json"], { "app.json": {} });
    assert.equal(verdict.ok, false);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.failure.code, "empty_input");
    assert.equal(verdict.failure.input, "app.json");
  });

  it("treats an explicit undefined as missing content, not as an absent key", () => {
    const verdict = evaluateParsedInputs(["a.json"], { "a.json": undefined });
    assert.equal(verdict.ok, false);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.failure.code, "empty_input");
  });

  it("fails an empty declaration — an inputs guard that names none checks none", () => {
    const verdict = evaluateParsedInputs([], { "a.json": { x: 1 } });
    assert.equal(verdict.ok, false);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.failure.code, "invalid_floor");
    assert.match(
      formatScannedFloorFailure("g", verdict.failure),
      /the caller declares an empty input list/,
    );
  });

  it("separates a file it could not read from one it never handed over", () => {
    // Both used to be `missing_input`, which reads as a wiring bug and hides
    // the ordinary cause: the scan root no longer holds the file.
    const verdict = evaluateParsedInputs(["app.json"], {
      "app.json": unreadableInput("ENOENT"),
    });
    assert.equal(verdict.ok, false);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.failure.code, "unreadable_input");
    assert.equal(verdict.failure.reason, "ENOENT");
    assert.match(
      formatScannedFloorFailure("g", verdict.failure),
      /input "app\.json" could not be read \(ENOENT\)/,
    );
  });

  it("does not read the unreadable marker as content just because it is an object", () => {
    // isNonEmptyInput answers true for any object with keys, so the marker
    // has to be checked before it.
    assert.equal(isUnreadableInput(unreadableInput("EACCES")), true);
    assert.equal(isUnreadableInput({ unreadableInput: false }), false);
    assert.equal(isUnreadableInput({ a: 1 }), false);
    assert.equal(isUnreadableInput(null), false);
    assert.equal(isUnreadableInput("ENOENT"), false);
  });

  it("names the offending input in both messages", () => {
    const missing = evaluateParsedInputs(["b.json"], {});
    const empty = evaluateParsedInputs(["b.json"], { "b.json": "" });
    assert.ok(!missing.ok && !empty.ok);
    if (missing.ok || empty.ok) throw new Error("unreachable");
    assert.match(
      formatScannedFloorFailure("g", missing.failure),
      /declared input "b\.json" was never handed/,
    );
    assert.match(
      formatScannedFloorFailure("g", empty.failure),
      /input "b\.json" is empty/,
    );
  });
});

describe("validateScannedFloorEntry", () => {
  const SOUND: ScannedFloor = {
    count: { label: "source file", minimum: 10 },
    note: "measured 2026-08-13",
  };
  const codesOf = (floor: ScannedFloor) =>
    validateScannedFloorEntry("check-x", floor).map((p) => p.code);

  it("finds nothing wrong with a sound entry, in each of the three shapes", () => {
    assert.deepEqual(codesOf(SOUND), []);
    assert.deepEqual(codesOf({ inputs: ["app.json"], note: "one fixed file" }), []);
    assert.deepEqual(codesOf({ delegatedTo: "somewhere else", note: "why" }), []);
    // The one guard that legitimately declares both shapes at once.
    assert.deepEqual(
      codesOf({ ...SOUND, inputs: ["docs/x.md"], note: "measured 2026-08-13" }),
      [],
    );
  });

  /** One fixture per problem code — the map the exhaustiveness test reads. */
  const BROKEN: Record<ScannedFloorProblemCode, ScannedFloor> = {
    no_shape: { note: "declares nothing" },
    invalid_minimum: { count: { label: "file", minimum: 0 }, note: "2026-08-13" },
    empty_label: { count: { label: " ", minimum: 10 }, note: "2026-08-13" },
    empty_inputs: { inputs: [], note: "nothing named" },
    blank_input: { inputs: ["app.json", "  "], note: "one is blank" },
    duplicate_input: { inputs: ["app.json", "app.json"], note: "twice" },
    delegation_with_shape: {
      count: { label: "file", minimum: 10 },
      delegatedTo: "elsewhere",
      note: "2026-08-13",
    },
    empty_delegation: { delegatedTo: "  ", note: "where?" },
    empty_note: { ...SOUND, note: "" },
    undated_note: { ...SOUND, note: "measured recently" },
  };

  for (const [code, floor] of Object.entries(BROKEN) as [
    ScannedFloorProblemCode,
    ScannedFloor,
  ][]) {
    it(`reports ${code}`, () => {
      assert.ok(
        codesOf(floor).includes(code),
        `expected ${code}, got ${codesOf(floor).join(", ") || "no problems"}`,
      );
    });
  }

  it("gives every problem code a fixture, so a new code cannot ship uncovered", () => {
    // Mirrors the exhaustive FAILURE_MESSAGE record: a code with no fixture
    // is a code nobody has ever seen fire.
    const covered = Object.keys(BROKEN) as ScannedFloorProblemCode[];
    const produced = new Set(
      Object.values(BROKEN).flatMap((floor) => codesOf(floor)),
    );
    for (const code of covered) {
      assert.ok(produced.has(code), `${code} has a fixture that does not produce it`);
    }
  });

  it("names the entry and reads as a sentence about it", () => {
    const [problem] = validateScannedFloorEntry("check-x", BROKEN.no_shape);
    assert.equal(problem.checkName, "check-x");
    assert.match(formatScannedFloorProblem(problem), /^check-x declares no premise/);
  });

  it("reports every problem with an entry, not just the first", () => {
    const codes = codesOf({ count: { label: "", minimum: -3 }, note: "" });
    assert.ok(codes.includes("invalid_minimum"));
    assert.ok(codes.includes("empty_label"));
    assert.ok(codes.includes("empty_note"));
  });

  it("does not ask an inputs-only or delegated entry to date its note", () => {
    // Only a count carries a measurement; the other two shapes have no
    // number to re-take, so a date would be decoration.
    assert.deepEqual(codesOf({ inputs: ["app.json"], note: "no date here" }), []);
    assert.deepEqual(codesOf({ delegatedTo: "elsewhere", note: "no date here" }), []);
  });
});

describe("scannedFloorFor rejects a bogus entry", () => {
  it("throws a ScannedFloorError so the wrapper prints it without a stack", () => {
    // The real table is sound, so this reaches the branch through the same
    // door a patched checkout does in lint-guard-invalid-floor.test.ts.
    const [problem] = validateScannedFloorEntry("check-x", { note: "" });
    assert.equal(problem.code, "no_shape");
    const line = formatScannedFloorFailure("check-x", {
      code: "invalid_floor",
      count: 0,
      minimum: 0,
      label: DEFAULT_SCANNED_LABEL,
      detail: `its SCANNED_FLOORS entry ${problem.detail}`,
    });
    assert.match(line, /^check-x: ERROR — its SCANNED_FLOORS entry declares no premise/);
    assert.match(line, /lib\/scanned-floor\.ts/);
  });

  it("still throws a plain Error for a guard with no entry at all", () => {
    // Unknown name and bogus entry are different bugs: one is a typo in the
    // guard, the other is a mistake in the table.
    assert.throws(() => scannedFloorFor("check-nothing"), (error: Error) => {
      assert.ok(!(error instanceof ScannedFloorError));
      return /no committed floor/.test(error.message);
    });
  });
});

describe("SCANNED_FLOORS", () => {
  const entries = Object.entries(SCANNED_FLOORS);

  it("is structurally sound — no bogus floor, no shapeless entry, no undated note", () => {
    // The four hand-rolled loops this replaces asserted the same properties
    // the guards themselves now depend on, from a second copy that could
    // drift. validateScannedFloors IS the contract; this reads it.
    assert.deepEqual(
      validateScannedFloors(SCANNED_FLOORS).map(formatScannedFloorProblem),
      [],
    );
  });

  it("covers every guard in the LINT_GUARDS registry, keyed by check name", () => {
    // The key is the guard's OWN name, so derive it from the script path the
    // registry already pins rather than from a second hand-kept list.
    for (const guard of LINT_GUARDS) {
      const checkName = guard.scriptPath.replace(/^scripts\//, "").replace(/\.ts$/, "");
      assert.ok(
        SCANNED_FLOORS[checkName],
        `${guard.npmScript} (${checkName}) has no entry in SCANNED_FLOORS`,
      );
    }
  });

  it("declares no floor for a guard that is not in the registry", () => {
    const registered = new Set(
      LINT_GUARDS.map((g) =>
        g.scriptPath.replace(/^scripts\//, "").replace(/\.ts$/, ""),
      ),
    );
    for (const [name] of entries) {
      assert.ok(registered.has(name), `${name} is a floor for a guard that does not exist`);
    }
  });
});

describe("scannedFloorFor", () => {
  it("returns the committed floor by check name", () => {
    assert.equal(
      scannedFloorFor("check-inline-hex").count?.minimum,
      SCANNED_FLOORS["check-inline-hex"].count?.minimum,
    );
  });

  it("throws for an unknown guard rather than defaulting to something safe", () => {
    // Defaulting would let a guard opt out of the floor by typo.
    assert.throws(
      () => scannedFloorFor("check-nothing"),
      /no committed floor for "check-nothing"/,
    );
  });
});

describe("countFloorFor", () => {
  it("narrows a count-shaped entry", () => {
    assert.equal(countFloorFor("check-secrets").minimum, 500);
  });

  it("throws rather than inventing a floor for an inputs-shaped guard", () => {
    assert.throws(
      () => countFloorFor("check-appstore-config"),
      /declares no count floor/,
    );
  });
});

describe("assertScannedFloor", () => {
  it("applies the guard's own committed floor", () => {
    const floor = countFloorFor("check-secrets");
    assert.doesNotThrow(() => assertScannedFloor("check-secrets", floor.minimum));
    assert.throws(
      () => assertScannedFloor("check-secrets", floor.minimum - 1),
      ScannedFloorError,
    );
  });
});

describe("assertParsedInputs", () => {
  it("applies the guard's own declared inputs", () => {
    assert.doesNotThrow(() =>
      assertParsedInputs("check-sentry-version", {
        "package.json": { name: "collectables" },
        "package-lock.json": { packages: {} },
      }),
    );
    assert.throws(
      () =>
        assertParsedInputs("check-sentry-version", {
          "package.json": { name: "collectables" },
        }),
      ScannedFloorError,
    );
  });

  it("throws rather than passing vacuously for a count-shaped guard", () => {
    assert.throws(
      () => assertParsedInputs("check-secrets", {}),
      /declares no fixed inputs/,
    );
  });
});

describe("the wrappers actually call it", () => {
  /** Every registry guard, with the script that runs it. */
  const WIRED = LINT_GUARDS.map((guard) => ({
    scriptPath: guard.scriptPath,
    checkName: guard.scriptPath.replace(/^scripts\//, "").replace(/\.ts$/, ""),
    floor: SCANNED_FLOORS[
      guard.scriptPath.replace(/^scripts\//, "").replace(/\.ts$/, "")
    ],
  }));

  for (const { scriptPath, checkName, floor } of WIRED) {
    it(`${scriptPath} names itself once, with the name its floor is keyed by`, () => {
      const declared = /const CHECK_NAME = "([^"]+)"/.exec(read(scriptPath))?.[1];
      assert.equal(
        declared,
        checkName,
        "the name in the report and the SCANNED_FLOORS key have to be the same string",
      );
    });

    if (floor?.delegatedTo) {
      it(`${scriptPath} enforces its premise where the table says it does`, () => {
        // The one guard that keeps its own refusal; the table names where.
        assert.match(floor.delegatedTo!, /\S/);
        assert.doesNotMatch(read(scriptPath), /assertScannedFloor\(/);
      });
      continue;
    }

    it(`${scriptPath} asserts its floor and prints the failure without a stack`, () => {
      const source = read(scriptPath);
      if (floor?.count) {
        assert.match(
          source,
          /assertScannedFloor\(\s*CHECK_NAME/,
          `${scriptPath} must assert its count floor`,
        );
      }
      if (floor?.inputs) {
        assert.match(
          source,
          /assertParsedInputs\(\s*CHECK_NAME/,
          `${scriptPath} must assert its declared inputs`,
        );
        for (const input of floor.inputs) {
          assert.ok(
            source.includes(`"${input}"`),
            `${scriptPath} declares "${input}" but never hands it over under that name`,
          );
        }
      }
      assert.match(
        source,
        /error instanceof ScannedFloorError/,
        `${scriptPath} must catch the floor error and exit 1 itself`,
      );
    });
  }

  it("asserts the premise BEFORE reporting a clean run, in every wrapper", () => {
    // Order is the whole point: a floor checked after the "no findings"
    // early return never runs on the run that needed it.
    for (const { scriptPath, floor } of WIRED) {
      if (floor?.delegatedTo) continue;
      const source = read(scriptPath);
      const assertAt = Math.min(
        ...[source.indexOf("assertScannedFloor("), source.indexOf("assertParsedInputs(")]
          .filter((i) => i >= 0),
      );
      const reportAt = source.indexOf("console.log(");
      assert.ok(assertAt > 0, `${scriptPath} asserts nothing`);
      assert.ok(reportAt > 0, `${scriptPath} prints nothing`);
      assert.ok(
        assertAt < reportAt,
        `${scriptPath} asserts its premise after it prints the pass line`,
      );
    }
  });

  it("catches the floor error in every wrapper that can throw one", () => {
    for (const { scriptPath, floor } of WIRED) {
      if (floor?.delegatedTo) continue;
      assert.match(
        read(scriptPath),
        /if \(error instanceof ScannedFloorError \|\| error instanceof GuardRootError\) \{\s*console\.error\(error\.message\);\s*process\.exit\(1\);/,
        `${scriptPath} must turn BOTH premise failures — the floor and a bad scan-root override — into one line and exit 1`,
      );
    }
  });
});
