/**
 * The rule `lib/scanned-floor.ts` kept by convention, now stated where it
 * applies.
 *
 * The module exports both halves of a problem sentence — a subject and a
 * clause — so a test can assert what a refusal says without re-typing a
 * fragment of it. That is also the hole: any file can import the two halves
 * and build its own `"<subject> <clause>"` string, and until this guard the
 * only thing standing against it was one regex over `lib/scanned-floor.ts`,
 * which sees a second reader IN THAT FILE and nothing anywhere else.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  findUnjoinedProblemPhrasingImports,
  formatProblemPhrasingReport,
  PROBLEM_PART_ACCESSORS,
  PROBLEM_SENTENCE_JOINERS,
} from "../lib/check-problem-phrasing-imports";

import { readRepoFile } from "./helpers/repo-file";


const find = (source: string) =>
  findUnjoinedProblemPhrasingImports("f.ts", source);

describe("findUnjoinedProblemPhrasingImports", () => {
  it("flags a part imported with no joiner beside it", () => {
    const matches = find(
      `import { scannedFloorProblemDetail } from "../lib/scanned-floor";\n` +
        `const line = "check-x " + scannedFloorProblemDetail("no_shape");\n`,
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].accessor, "scannedFloorProblemDetail");
    assert.equal(matches[0].line, 1);
    assert.match(matches[0].snippet, /import \{ scannedFloorProblemDetail \}/);
  });

  it("flags the subject accessor for the same reason", () => {
    const matches = find(
      `import { scannedFloorProblemSubject } from "@/lib/scanned-floor";\n`,
    );
    assert.deepEqual(
      matches.map((m) => m.accessor),
      ["scannedFloorProblemSubject"],
    );
  });

  it("reports both parts when a file reads both and joins neither", () => {
    // The worst case, and the one that reads most like the module's own
    // sentence: a file holding a subject and a clause is one `+` away from a
    // phrasing nothing in the repository can assert against.
    const matches = find(
      `import { scannedFloorProblemSubject, scannedFloorProblemDetail } from "../lib/scanned-floor";\n`,
    );
    assert.deepEqual(matches.map((m) => m.accessor).sort(), [
      ...PROBLEM_PART_ACCESSORS,
    ].sort());
  });

  it("passes a file that imports a joiner alongside", () => {
    for (const joiner of PROBLEM_SENTENCE_JOINERS) {
      assert.deepEqual(
        find(
          `import { scannedFloorProblemDetail, ${joiner} } from "../lib/scanned-floor";\n`,
        ),
        [],
        `${joiner} did not count as a joiner`,
      );
    }
  });

  it("counts a joiner imported on a second statement", () => {
    // Two import lines from the same module is ordinary formatting, not an
    // evasion — the bindings are gathered across every matching statement.
    assert.deepEqual(
      find(
        `import { scannedFloorProblemDetail } from "../lib/scanned-floor";\n` +
          `import { describeScannedFloorProblem } from "../lib/scanned-floor";\n`,
      ),
      [],
    );
  });

  it("ignores a file that imports neither half", () => {
    assert.deepEqual(
      find(`import { assertScannedFloor } from "../lib/scanned-floor";\n`),
      [],
    );
    assert.deepEqual(find(`const x = 1;\n`), []);
  });

  it("does not fire on prose in a comment", () => {
    // This test file, the guard's own module and its wrapper all NAME the
    // accessors in doc blocks; a guard that read comments would refuse on its
    // own source.
    assert.deepEqual(
      find(
        `// scannedFloorProblemDetail is half a sentence\n` +
          `/* scannedFloorProblemSubject too */\n` +
          `import { assertScanned } from "../lib/scanned-floor";\n`,
      ),
      [],
    );
  });

  it("reads through a namespace import rather than letting it walk around the rule", () => {
    // One extra line of syntax is all it would take, so the guard follows it.
    const matches = find(
      `import * as floor from "../lib/scanned-floor";\n` +
        `const line = "check-x " + floor.scannedFloorProblemDetail("no_shape");\n`,
    );
    assert.deepEqual(
      matches.map((m) => m.accessor),
      ["scannedFloorProblemDetail"],
    );
    assert.equal(matches[0].line, 2);
  });

  it("accepts a namespace import that reaches for a joiner", () => {
    assert.deepEqual(
      find(
        `import * as floor from "../lib/scanned-floor";\n` +
          `const line = floor.describeScannedFloorProblem("check-x", "no_shape");\n` +
          `const clause = floor.scannedFloorProblemDetail("no_shape");\n`,
      ),
      [],
    );
  });

  it("ignores a namespace import that touches no phrasing at all", () => {
    assert.deepEqual(
      find(
        `import * as floor from "../lib/scanned-floor";\n` +
          `floor.assertScannedFloor("check-x", 10);\n`,
      ),
      [],
    );
  });

  it("does not match a longer neighbouring module name", () => {
    assert.deepEqual(
      find(
        `import { scannedFloorProblemDetail } from "../lib/scanned-floor-extras";\n`,
      ),
      [],
    );
  });

  it("handles type-only and aliased bindings", () => {
    // `import type { ... }` and `a as b` are how the repo already writes
    // imports; a parser that choked on either would report a file that is fine.
    assert.deepEqual(
      find(
        `import { type ScannedFloorProblemCode, scannedFloorProblemDetail as detailFor } from "../lib/scanned-floor";\n`,
      ).map((m) => m.accessor),
      ["scannedFloorProblemDetail"],
    );
  });
});

describe("formatProblemPhrasingReport", () => {
  it("says nothing when there is nothing to say", () => {
    assert.equal(formatProblemPhrasingReport([]), "");
  });

  it("names the file, the accessor and the way out", () => {
    const report = formatProblemPhrasingReport(
      find(`import { scannedFloorProblemDetail } from "../lib/scanned-floor";\n`),
    );
    assert.match(report, /f\.ts:1/);
    assert.match(report, /scannedFloorProblemDetail/);
    // The report has to name the joiners, or it states a rule without saying
    // how to satisfy it.
    for (const joiner of PROBLEM_SENTENCE_JOINERS) {
      assert.ok(report.includes(joiner), `report never mentions ${joiner}`);
    }
  });
});

describe("the repository itself", () => {
  const READERS = [
    "lib/scanned-floor.ts",
    "__tests__/scanned-floor.test.ts",
    "__tests__/lint-guard-invalid-floor.test.ts",
    "lib/check-problem-phrasing-imports.ts",
    "scripts/check-problem-phrasing-imports.ts",
  ];

  for (const file of READERS) {
    it(`${file} is clean under the rule it is subject to`, () => {
      const source = readRepoFile(file);
      assert.deepEqual(findUnjoinedProblemPhrasingImports(file, source), []);
    });
  }

  it("exempts lib/scanned-floor.ts by construction, not by a special case", () => {
    // The declaring module imports none of these names from itself, so the
    // guard has no exemption list to fall out of date.
    const source = readRepoFile("lib/scanned-floor.ts");
    assert.doesNotMatch(source, /from\s*["'][^"']*\/scanned-floor["']/);
  });
});
