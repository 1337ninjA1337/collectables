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
  describeScannedFloorProblem,
  describeScannedFloorProblemRef,
  scannedFloorProblemSubject,
  FLOOR_BELOW_ONE_REASON,
  formatScannedFloorFailure,
  formatScannedFloorProblem,
  PARSED_INPUTS_CALLER_SUBJECT,
  SCANNED_FLOORS_ENTRY_SUBJECT,
  SHAPE_MISMATCH_REASON,
  isNonEmptyInput,
  isUnreadableInput,
  scannedFloorFor,
  unreadableInput,
  validateScannedFloorEntry,
  validateScannedFloors,
  type ScannedFloor,
  scannedFloorProblemDetail,
  type ScannedFloorFailure,
  type ScannedFloorFailureCode,
  type ScannedFloorProblem,
  type ScannedFloorProblemCode,
  type ScannedFloorProblemSubject,
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

const inputFailureOf = (
  declared: readonly string[],
  values: Readonly<Record<string, unknown>>,
) => {
  const verdict = evaluateParsedInputs(declared, values);
  assert.equal(verdict.ok, false, `expected ${declared.join(", ")} to fail`);
  if (verdict.ok) throw new Error("unreachable");
  return verdict.failure;
};

/**
 * The failure a lookup THREW, for the three codes no pure evaluator returns.
 *
 * `scannedFloorFor`, `countFloorFor` and `assertParsedInputs` do not hand back
 * a verdict — an unusable premise stops the guard — so the only way to get at
 * the failure they build is to catch it. Insisting on `ScannedFloorError` here
 * is half the point of these codes existing: a bare `Error` would sail past the
 * wrapper's handler as a stack trace.
 */
const failureFromThrow = (call: () => unknown): ScannedFloorFailure => {
  try {
    call();
  } catch (error) {
    assert.ok(
      error instanceof ScannedFloorError,
      `expected a ScannedFloorError, got ${String(error)}`,
    );
    return error.failure;
  }
  throw new Error("expected the lookup to throw, and it returned");
};

/**
 * Exhaustive by construction: a new ScannedFloorProblemCode fails to COMPILE
 * here until it is listed, the same trick PROBLEM_DETAIL uses one file over.
 * Module-scope because two blocks need it — the phrasing assertions and the
 * failure-surface ones, which is the whole set of places a code turns into
 * words.
 */
const EVERY_PROBLEM_CODE: Record<ScannedFloorProblemCode, true> = {
  empty_check_name: true,
  no_shape: true,
  invalid_minimum: true,
  empty_label: true,
  empty_inputs: true,
  blank_input: true,
  duplicate_input: true,
  delegation_with_shape: true,
  empty_delegation: true,
  empty_note: true,
  undated_note: true,
};

const PROBLEM_CODES = Object.keys(EVERY_PROBLEM_CODE) as ScannedFloorProblemCode[];

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
    // The subject is the CALLER, not the table: `scannedFloorFor` rejects an
    // `inputs: []` entry before a guard can reach this, so the only way in is
    // a direct call. Both halves are read from the module rather than
    // re-typed, which is the whole point of the accessor pair.
    assert.ok(
      formatScannedFloorFailure("g", verdict.failure).includes(
        describeScannedFloorProblem(PARSED_INPUTS_CALLER_SUBJECT, "empty_inputs"),
      ),
    );
    assert.equal(PARSED_INPUTS_CALLER_SUBJECT, "the caller");
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
  const codesOf = (floor: ScannedFloor, checkName = "check-x") =>
    validateScannedFloorEntry(checkName, floor).map((p) => p.code);

  /**
   * The key a fixture is validated under. Only `empty_check_name` needs one:
   * it is the single problem about the entry's NAME rather than the
   * declaration under it, so its fixture varies the key and reuses a sound
   * floor — the point being that nothing else about the entry is wrong.
   */
  const BROKEN_UNDER: Partial<Record<ScannedFloorProblemCode, string>> = {
    empty_check_name: "  ",
  };
  const nameFor = (code: ScannedFloorProblemCode) => BROKEN_UNDER[code] ?? "check-x";

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
    // Sound in every other respect; the key it is validated under is the bug.
    empty_check_name: SOUND,
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
      const codes = codesOf(floor, nameFor(code));
      assert.ok(
        codes.includes(code),
        `expected ${code}, got ${codes.join(", ") || "no problems"}`,
      );
    });
  }

  it("gives every problem code a fixture, so a new code cannot ship uncovered", () => {
    // Mirrors the exhaustive FAILURE_MESSAGE record: a code with no fixture
    // is a code nobody has ever seen fire.
    const covered = Object.keys(BROKEN) as ScannedFloorProblemCode[];
    const produced = new Set(
      covered.flatMap((code) => codesOf(BROKEN[code], nameFor(code))),
    );
    for (const code of covered) {
      assert.ok(produced.has(code), `${code} has a fixture that does not produce it`);
    }
  });

  it("has a sentence for every code it reports, reached through the code alone", () => {
    // A problem carries WHICH entry and HOW, never the words — so the only
    // route from a reported problem to what it says is the accessor, and the
    // thing worth asserting is that the route arrives somewhere.
    for (const [code, floor] of Object.entries(BROKEN) as [
      ScannedFloorProblemCode,
      ScannedFloor,
    ][]) {
      const problem = validateScannedFloorEntry(nameFor(code), floor).find(
        (candidate) => candidate.code === code,
      );
      assert.ok(problem, `${code} produced no problem to read a sentence from`);
      const detail = scannedFloorProblemDetail(problem.code);
      assert.ok(detail.trim().length > 0, `${code} carries no sentence`);
    }
  });

  it("names the entry and reads as a sentence about it", () => {
    const [problem] = validateScannedFloorEntry("check-x", BROKEN.no_shape);
    assert.equal(problem.checkName, "check-x");
    assert.match(formatScannedFloorProblem(problem), /^check-x declares no premise/);
  });

  it("reports a blank key on an otherwise sound entry, and only that", () => {
    // The one problem about the entry's NAME. Everything under the key is
    // fine, which is exactly what makes it invisible to the other ten checks.
    assert.deepEqual(codesOf(SOUND, ""), ["empty_check_name"]);
    assert.deepEqual(codesOf(SOUND, "   "), ["empty_check_name"]);
    assert.deepEqual(codesOf(SOUND, "check-x"), []);
  });

  it("reports the blank key first, so a wrapper raises the missing name", () => {
    // `scannedFloorFor` raises the FIRST problem. A blank key reported second
    // would be printed as whatever else the entry got wrong, under a subject
    // that is a space — the failure mode this code exists to end.
    const [first] = validateScannedFloorEntry("", { note: "" });
    assert.equal(first.code, "empty_check_name");
  });

  it("catches a blank key through the whole-table validator too", () => {
    // The route it actually travels: no wrapper asks for its floor under a
    // blank literal, so the table-wide pass is where an empty key surfaces.
    assert.deepEqual(
      validateScannedFloors({ "": SOUND }).map((p) => p.code),
      ["empty_check_name"],
    );
    for (const checkName of Object.keys(SCANNED_FLOORS)) {
      assert.ok(checkName.trim().length > 0, `SCANNED_FLOORS has a blank key`);
    }
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
      problem: { subject: "entry", code: problem.code },
    });
    assert.match(line, /^check-x: ERROR — its SCANNED_FLOORS entry declares no premise/);
    assert.match(line, /lib\/scanned-floor\.ts/);
  });

  it("throws a ScannedFloorError for a guard with no entry at all, too", () => {
    // Unknown name and bogus entry are different bugs — one is a typo in the
    // guard, the other a mistake in the table — and they used to print
    // differently for no better reason than that one of them predated the
    // failure table. A missing entry was a bare `Error`, which the wrapper's
    // handler does not recognise and re-throws as a node stack.
    assert.throws(() => scannedFloorFor("check-nothing"), (error: Error) => {
      assert.ok(error instanceof ScannedFloorError);
      assert.equal(error.failure.code, "no_floor_declared");
      assert.equal(error.checkName, "check-nothing");
      return /^check-nothing: ERROR — no committed floor/.test(error.message);
    });
  });

  it("prints the two unusable-premise failures in the same shape", () => {
    // The point of the change: whichever way this guard's premise is
    // unusable — absent from the table or bogus in it — the reader gets one
    // line, headed by the guard's name, pointing at the same file.
    const lines = [
      formatScannedFloorFailure("check-x", {
        code: "no_floor_declared",
        count: 0,
        minimum: 0,
        label: DEFAULT_SCANNED_LABEL,
      }),
      formatScannedFloorFailure("check-x", {
        code: "invalid_floor",
        count: 0,
        minimum: 0,
        label: DEFAULT_SCANNED_LABEL,
        problem: { subject: "entry", code: "no_shape" },
      }),
    ];
    for (const line of lines) {
      assert.match(line, /^check-x: ERROR — /);
      assert.match(line, /lib\/scanned-floor\.ts/);
      assert.equal(line.split("\n").length, 1);
    }
  });
});

describe("one problem, one phrasing", () => {
  const codes = PROBLEM_CODES;

  it("joins the subject to the table's own clause, leaving the clause untouched", () => {
    for (const code of codes) {
      const clause = scannedFloorProblemDetail(code);
      assert.equal(describeScannedFloorProblem("check-x", code), `check-x ${clause}`);
      // The accessor is the raw clause — a predicate with no subject — so it
      // must not already carry one, or every sentence built from it reads
      // "check-x check-x declares ...".
      assert.ok(
        !clause.startsWith("check-x"),
        `${code}'s clause names its own subject`,
      );
    }
  });

  it("makes the one blank-subject sentence explain itself", () => {
    // `formatScannedFloorProblem` renders the entry's key as the subject, so
    // the single problem whose subject IS blank cannot be joined into a
    // headless sentence quietly: its clause has to say that the missing first
    // word is the finding. The line still opens with a space — and now that
    // space is what the sentence is about.
    const line = formatScannedFloorProblem({ checkName: "", code: "empty_check_name" });
    assert.equal(line, ` ${scannedFloorProblemDetail("empty_check_name")}`);
    assert.match(line, /blank name/);
  });

  it("gives formatScannedFloorProblem the check name as its subject and nothing else", () => {
    for (const code of codes) {
      assert.equal(
        formatScannedFloorProblem({ checkName: "check-x", code }),
        describeScannedFloorProblem("check-x", code),
      );
    }
  });

  it("keeps the two subjects distinct — an entry's problem is not a caller's", () => {
    // They differ because the reader's next move differs: one sends them to
    // SCANNED_FLOORS, the other to whoever called the pure function with an
    // empty list. Collapsing them would point half the readers at a sound row.
    assert.notEqual(SCANNED_FLOORS_ENTRY_SUBJECT, PARSED_INPUTS_CALLER_SUBJECT);
    for (const code of codes) {
      assert.notEqual(
        describeScannedFloorProblem(SCANNED_FLOORS_ENTRY_SUBJECT, code),
        describeScannedFloorProblem(PARSED_INPUTS_CALLER_SUBJECT, code),
      );
    }
  });

  it("carries the clause the code declares, whichever subject is speaking", () => {
    for (const code of codes) {
      const clause = scannedFloorProblemDetail(code);
      for (const subject of [
        SCANNED_FLOORS_ENTRY_SUBJECT,
        PARSED_INPUTS_CALLER_SUBJECT,
        "check-x",
      ]) {
        assert.ok(describeScannedFloorProblem(subject, code).endsWith(clause));
      }
    }
  });

  it("reports which entry and how, and carries no words of its own", () => {
    // The field this replaces was always `scannedFloorProblemDetail(code)` and
    // every renderer derived the words from `code` anyway — so a problem built
    // by hand could carry a sentence that would never be printed. Now the only
    // route from a problem to its words is the accessor.
    //
    // The claim is about the TYPE, not about one fixture: `keyof` makes a
    // re-added words field fail to compile here, which a runtime key check
    // over produced problems cannot see (a declared-but-never-populated field
    // is invisible to it). The runtime half then pins that the producer fills
    // exactly the fields the type declares — neither claim implies the other.
    const EVERY_PROBLEM_FIELD: Record<keyof ScannedFloorProblem, true> = {
      checkName: true,
      code: true,
    };
    const declared = Object.keys(EVERY_PROBLEM_FIELD).sort();
    assert.deepEqual(declared, ["checkName", "code"]);
    const problems = validateScannedFloorEntry("check-x", {
      count: { label: "", minimum: -3 },
      note: "",
    });
    assert.ok(problems.length >= 3);
    for (const problem of problems) {
      assert.deepEqual(Object.keys(problem).sort(), declared);
    }
  });

  it("says why a floor below 1 is a bug in the same words from both sides", () => {
    // Two unrelated sentences shared this clause verbatim: the runtime failure
    // (a number a caller passed) and the table problem (a number an entry
    // declares). Two copies of one reason drift the first time either is
    // reworded, and the reader who meets the second one has no way to tell it
    // is the same rule. Read from both messages rather than re-typed here.
    const runtime = formatScannedFloorFailure("check-x", {
      code: "invalid_floor",
      count: 3,
      minimum: 0,
      label: DEFAULT_SCANNED_LABEL,
    });
    assert.ok(
      runtime.includes(FLOOR_BELOW_ONE_REASON),
      `runtime failure lost the shared clause:\n${runtime}`,
    );
    assert.ok(
      scannedFloorProblemDetail("invalid_minimum").includes(FLOOR_BELOW_ONE_REASON),
      "the table problem lost the shared clause",
    );
    // Neither sentence may be JUST the shared clause, or "both say it" is
    // satisfied by two messages that say nothing else.
    assert.notEqual(scannedFloorProblemDetail("invalid_minimum"), FLOOR_BELOW_ONE_REASON);
  });

  it("leaves exactly one reader of the sentence table in the source", () => {
    // The drift guard, and the reason this block exists: three call sites used
    // to build "<subject> <sentence>" themselves. A fourth would be invisible
    // to every assertion above, because each of those only ever exercises the
    // function it already goes through.
    const source = read("lib/scanned-floor.ts");
    // Both ways the record can be read — `PROBLEM_DETAIL[code]` and the
    // `PROBLEM_DETAIL.empty_inputs` shape the caller branch used to carry.
    const readers = source.match(/PROBLEM_DETAIL[.[]/g) ?? [];
    assert.deepEqual(readers, ["PROBLEM_DETAIL["], "PROBLEM_DETAIL grew a second reader");
    assert.ok(
      !/\$\{problem\.detail\}/.test(source),
      "a call site is interpolating problem.detail instead of calling describeScannedFloorProblem",
    );
  });
});

describe("a failure carries a problem, not a sentence about one", () => {
  /**
   * One producer per failure code, so the surface assertions below run over
   * everything a caller can actually receive rather than over the one code
   * this change is about. A new `ScannedFloorFailureCode` fails to compile
   * here until it names the call that produces it.
   */
  const EVERY_FAILURE: Record<ScannedFloorFailureCode, () => ScannedFloorFailure> = {
    no_files: () => failureOf(0, 150, "source file"),
    below_floor: () => failureOf(3, 150, "source file"),
    invalid_floor: () => failureOf(10, 0),
    missing_input: () => inputFailureOf(["a.json"], {}),
    unreadable_input: () =>
      inputFailureOf(["a.json"], { "a.json": unreadableInput("EACCES") }),
    empty_input: () => inputFailureOf(["a.json"], { "a.json": {} }),
    // The three lookup codes have no pure evaluator to produce them: they are
    // raised by the table lookups, so the producer is the throw itself.
    no_floor_declared: () => failureFromThrow(() => scannedFloorFor("check-nothing")),
    no_count_floor: () =>
      failureFromThrow(() => countFloorFor("check-appstore-config")),
    no_inputs_floor: () =>
      failureFromThrow(() => assertParsedInputs("check-secrets", {})),
  };
  const failureCodes = Object.keys(EVERY_FAILURE) as ScannedFloorFailureCode[];

  it("produces the code each fixture claims, so the surface checks are about it", () => {
    for (const code of failureCodes) {
      assert.equal(EVERY_FAILURE[code]().code, code);
    }
  });

  it("never carries a rendered problem sentence on any failure code", () => {
    // The property the `detail` field could not have: a failure crosses from
    // the pure function that found the problem to the wrapper that prints it,
    // and along the way there is nowhere to put words this module did not
    // write. Checked against every clause in the table, on every value of
    // every failure — a producer that started pasting one in would fail here
    // whichever field it chose.
    for (const code of failureCodes) {
      const failure = EVERY_FAILURE[code]();
      for (const [field, value] of Object.entries(failure)) {
        if (typeof value !== "string") continue;
        for (const problemCode of PROBLEM_CODES) {
          assert.ok(
            !value.includes(scannedFloorProblemDetail(problemCode)),
            `${code}.${field} carries the ${problemCode} sentence verbatim`,
          );
        }
      }
    }
  });

  it("declares no field a caller could fill with prose", () => {
    // `keyof`, so a re-added words field is a compile error rather than
    // something the runtime loop above has to happen to catch.
    const EVERY_FAILURE_FIELD: Record<keyof ScannedFloorFailure, true> = {
      code: true,
      count: true,
      minimum: true,
      label: true,
      input: true,
      reason: true,
      problem: true,
    };
    assert.deepEqual(Object.keys(EVERY_FAILURE_FIELD).sort(), [
      "code",
      "count",
      "input",
      "label",
      "minimum",
      "problem",
      "reason",
    ]);
    for (const code of failureCodes) {
      for (const field of Object.keys(EVERY_FAILURE[code]())) {
        assert.ok(
          field in EVERY_FAILURE_FIELD,
          `${code} carries an undeclared field "${field}"`,
        );
      }
    }
  });

  it("attaches a problem to invalid_floor and to nothing else", () => {
    // `problem` is optional because ONE invalid_floor is not about a
    // declaration at all (a bogus number straight from a caller); it must
    // still be impossible for a tree-shaped failure to claim a structural one.
    for (const code of failureCodes) {
      if (code === "invalid_floor") continue;
      assert.equal(EVERY_FAILURE[code]().problem, undefined, code);
    }
  });

  it("renders a table problem from its code, in the entry's voice", () => {
    // Every one of the ten codes, through the failure path — the sentence a
    // guard prints for a bogus entry is now derived, so this is a claim about
    // all of them rather than about whichever ones a fixture produces.
    for (const code of PROBLEM_CODES) {
      const line = formatScannedFloorFailure("check-x", {
        code: "invalid_floor",
        count: 0,
        minimum: 0,
        label: DEFAULT_SCANNED_LABEL,
        problem: { subject: "entry", code },
      });
      assert.ok(
        line.includes(describeScannedFloorProblem(SCANNED_FLOORS_ENTRY_SUBJECT, code)),
        `invalid_floor lost the ${code} sentence:\n${line}`,
      );
      assert.match(line, /^check-x: ERROR — /);
    }
  });

  it("says the same thing whichever subject the ref names", () => {
    for (const code of PROBLEM_CODES) {
      for (const subject of ["entry", "caller"] as ScannedFloorProblemSubject[]) {
        assert.equal(
          describeScannedFloorProblemRef({ subject, code }),
          describeScannedFloorProblem(scannedFloorProblemSubject(subject), code),
        );
      }
    }
  });

  it("resolves the two subject ids to the two exported phrases and no others", () => {
    // The ids exist so a failure can travel without words; the constants exist
    // so a test can name a subject without re-typing it. Read from both sides
    // here, or the record and the constants drift into two vocabularies.
    const EVERY_SUBJECT: Record<ScannedFloorProblemSubject, string> = {
      entry: SCANNED_FLOORS_ENTRY_SUBJECT,
      caller: PARSED_INPUTS_CALLER_SUBJECT,
    };
    for (const [subject, words] of Object.entries(EVERY_SUBJECT) as [
      ScannedFloorProblemSubject,
      string,
    ][]) {
      assert.equal(scannedFloorProblemSubject(subject), words);
      assert.ok(words.trim().length > 0, `${subject} resolves to nothing`);
    }
    assert.notEqual(
      scannedFloorProblemSubject("entry"),
      scannedFloorProblemSubject("caller"),
    );
  });

  it("keeps the numeric branch reachable, and about the number", () => {
    // The branch is not a fallback for a missing sentence any more — it is the
    // one invalid_floor that has no entry to blame, so it must name the number
    // the caller passed and must NOT sound like a finding about the table.
    const line = formatScannedFloorFailure("check-x", failureOf(10, 0));
    assert.match(line, /floor of 0 is not a positive integer/);
    assert.ok(line.includes(FLOOR_BELOW_ONE_REASON));
    assert.ok(
      !line.includes(SCANNED_FLOORS_ENTRY_SUBJECT),
      `a bogus number was reported as an entry problem:\n${line}`,
    );
  });

  it("leaves exactly one reader of the subject table in the source", () => {
    // Same drift guard as PROBLEM_DETAIL's, for the same reason: a second
    // reader is a second phrasing of "who this is about" waiting to happen.
    const source = read("lib/scanned-floor.ts");
    const readers = source.match(/PROBLEM_SUBJECT[.[]/g) ?? [];
    assert.deepEqual(readers, ["PROBLEM_SUBJECT["], "PROBLEM_SUBJECT grew a second reader");
    assert.ok(
      !/\bf\.detail\b|failure\.detail\b/.test(source),
      "a renderer is reading a words field off the failure again",
    );
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
      /^ScannedFloorError: check-nothing: ERROR — no committed floor/,
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
      /^ScannedFloorError: check-appstore-config: ERROR — asked for a count floor/,
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
      /^ScannedFloorError: check-secrets: ERROR — asked for its declared inputs/,
    );
  });
});

describe("an unusable premise refuses in one line, whichever way it is unusable", () => {
  /**
   * The three lookup failures and the call that raises each. Not derived from
   * a fixture: the whole claim is about what these three CALLS do when a
   * wrapper asks for something the table cannot give it.
   */
  const LOOKUPS: readonly {
    readonly code: ScannedFloorFailureCode;
    readonly checkName: string;
    readonly call: () => unknown;
  }[] = [
    {
      code: "no_floor_declared",
      checkName: "check-nothing",
      call: () => scannedFloorFor("check-nothing"),
    },
    {
      code: "no_count_floor",
      checkName: "check-appstore-config",
      call: () => countFloorFor("check-appstore-config"),
    },
    {
      code: "no_inputs_floor",
      checkName: "check-secrets",
      call: () => assertParsedInputs("check-secrets", {}),
    },
  ];

  for (const { code, checkName, call } of LOOKUPS) {
    it(`raises ${code} as a ScannedFloorError the wrapper can print`, () => {
      // The bug this closes: all three were bare `Error`s, and every wrapper's
      // handler catches `ScannedFloorError` and re-throws anything else. So the
      // three most likely consequences of a rename printed as node stacks
      // while the ten ways an entry can be malformed printed as one line.
      const failure = failureFromThrow(call);
      assert.equal(failure.code, code);
      const line = formatScannedFloorFailure(checkName, failure);
      assert.match(line, new RegExp(`^${checkName}: ERROR — `));
      assert.equal(line.split("\n").length, 1, `${code} prints more than one line`);
      assert.match(line, /lib\/scanned-floor\.ts/);
    });

    it(`says nothing about the tree on a ${code} failure`, () => {
      // None of the three is a finding about a walk: the numbers on the
      // failure are placeholders, so a message quoting one would be inventing
      // a measurement nobody took, and the remeasure hint would send the
      // reader to change a number that is not the problem.
      const line = formatScannedFloorFailure(checkName, failureFromThrow(call));
      assert.doesNotMatch(line, /Check the scan roots/);
      assert.doesNotMatch(line, /re-measure the floor/);
      assert.doesNotMatch(line, /scanned 0/);
    });
  }

  it("says why a shape mismatch is a bug in the same words from both sides", () => {
    // Two sentences about one disagreement, one per direction. Read from the
    // messages rather than re-typed here, so a rewording of either has to keep
    // the shared reason or fail.
    const lines = [
      formatScannedFloorFailure("check-x", failureFromThrow(LOOKUPS[1].call)),
      formatScannedFloorFailure("check-x", failureFromThrow(LOOKUPS[2].call)),
    ];
    for (const line of lines) {
      assert.ok(line.includes(SHAPE_MISMATCH_REASON), `lost the shared clause:\n${line}`);
      // Neither may be JUST the shared clause, or "both say it" is satisfied
      // by two messages that say nothing else — and the two directions differ
      // in which assertion the wrapper should have called instead.
      assert.notEqual(line, SHAPE_MISMATCH_REASON);
    }
    assert.notEqual(lines[0], lines[1]);
    assert.match(lines[0], /assertParsedInputs/);
    assert.match(lines[1], /assertScannedFloor/);
  });

  it("leaves no bare Error on the lookup path in the source", () => {
    // The drift guard. Every assertion above goes through a call that throws
    // today; a FOURTH lookup added later could reintroduce the bare `Error`
    // and no test above would be able to see it.
    const source = read("lib/scanned-floor.ts");
    const table = source.slice(source.indexOf("export const SCANNED_FLOORS"));
    assert.ok(
      !/throw new Error\(/.test(table),
      "a lookup below SCANNED_FLOORS throws a bare Error — the wrapper re-throws those as a stack trace",
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
