import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_SCANNED_LABEL,
  SCANNED_FLOORS,
  ScannedFloorError,
  assertScanned,
  assertScannedFloor,
  evaluateScannedFloor,
  formatScannedFloorFailure,
  scannedFloorFor,
} from "../lib/scanned-floor";

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

describe("SCANNED_FLOORS", () => {
  it("gives every entry a positive integer floor", () => {
    for (const [name, floor] of Object.entries(SCANNED_FLOORS)) {
      assert.ok(
        Number.isInteger(floor.minimum) && floor.minimum >= 1,
        `${name} floor must be a positive integer`,
      );
    }
  });

  it("gives every entry a note that says when it was measured", () => {
    for (const [name, floor] of Object.entries(SCANNED_FLOORS)) {
      assert.ok(floor.label.length > 0, `${name} needs a label`);
      assert.match(
        floor.note,
        /\d{4}-\d{2}-\d{2}/,
        `${name} note must date the measurement — a floor with no measurement is a magic constant`,
      );
    }
  });

  it("covers the two guards wired so far", () => {
    assert.ok(SCANNED_FLOORS["check-inline-hex"]);
    assert.ok(SCANNED_FLOORS["check-secrets"]);
  });
});

describe("scannedFloorFor", () => {
  it("returns the committed floor by check name", () => {
    assert.equal(
      scannedFloorFor("check-inline-hex").minimum,
      SCANNED_FLOORS["check-inline-hex"].minimum,
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

describe("assertScannedFloor", () => {
  it("applies the guard's own committed floor", () => {
    const floor = SCANNED_FLOORS["check-secrets"];
    assert.doesNotThrow(() =>
      assertScannedFloor("check-secrets", floor.minimum),
    );
    assert.throws(
      () => assertScannedFloor("check-secrets", floor.minimum - 1),
      ScannedFloorError,
    );
  });
});

describe("the wrappers actually call it", () => {
  const WIRED: ReadonlyArray<readonly [string, string]> = [
    ["scripts/check-inline-hex.ts", "check-inline-hex"],
    ["scripts/check-secrets.ts", "check-secrets"],
  ];

  for (const [scriptPath, checkName] of WIRED) {
    it(`${scriptPath} asserts its floor and prints the failure without a stack`, () => {
      const source = read(scriptPath);
      assert.match(
        source,
        new RegExp(`assertScannedFloor\\(\\s*CHECK_NAME`),
        `${scriptPath} must assert the floor after its walk`,
      );
      assert.match(
        source,
        /const CHECK_NAME = "([^"]+)"/,
        `${scriptPath} must name itself once`,
      );
      const declared = /const CHECK_NAME = "([^"]+)"/.exec(source)?.[1];
      assert.equal(
        declared,
        checkName,
        "the name in the report and the SCANNED_FLOORS key have to be the same string",
      );
      assert.match(
        source,
        /error instanceof ScannedFloorError/,
        `${scriptPath} must catch the floor error and exit 1 itself`,
      );
    });

    it(`${checkName} has a committed floor in SCANNED_FLOORS`, () => {
      assert.ok(SCANNED_FLOORS[checkName]);
    });
  }

  it("asserts the floor BEFORE reporting a clean scan", () => {
    // Order is the whole point: a floor checked after the "no findings"
    // early return never runs on the run that needed it.
    for (const [scriptPath] of WIRED) {
      const source = read(scriptPath);
      const assertAt = source.indexOf("assertScannedFloor(");
      const reportAt = source.indexOf("scanned ${files.length}");
      assert.ok(assertAt > 0 && reportAt > 0);
      assert.ok(
        assertAt < reportAt,
        `${scriptPath} asserts its floor after it prints the pass line`,
      );
    }
  });
});
