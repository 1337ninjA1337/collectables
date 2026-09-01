/**
 * The rule about block comments that end inside their own body.
 *
 * A doc comment in `scripts/record-loaded-files.ts` said what
 * `tsconfig.json`'s `include` was and wrote the glob out. A path glob of that
 * shape ends in the two characters that close a block comment, so the comment
 * ended mid-sentence and the rest of the paragraph became code. `tsc` reported
 * six syntax errors, every one pointing at prose, the first of them
 * "Expression expected" at a column inside a noun phrase.
 *
 * The typecheck already CATCHES this. What it cannot do is say why, and that
 * is the whole value of the guard: a contributor whose only change was a
 * paragraph gets a list of complaints about code they did not write.
 *
 * The rule is narrow because a wider one would be disabled. It looks only at
 * lines beginning with a star — the continuation lines of a doc comment, where
 * every line is one — so an inline block comment with code after it on the same
 * line is untouched. Measured over this tree: zero findings across 810 files,
 * and it flags the real case.
 *
 * This suite cannot write the terminator out either, which is why its fixtures
 * build it from parts. That is not a trick to get around the rule; it is the
 * same thing the rule asks every other file to do.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  EARLY_TERMINATOR_ADVICE,
  TRAILING_LIMIT,
  findEarlyTerminators,
  formatEarlyTerminatorReport,
} from "../lib/check-comment-terminators";
import { LINT_GUARDS } from "../lib/lint-guards";
import { SCANNED_FLOORS } from "../lib/scanned-floor";
import { REPO_ROOT } from "./helpers/repo-file";
import { SUITES_REL } from "./helpers/suite-files";

/**
 * The two characters, assembled rather than typed.
 *
 * Spelling them out in this file would end this file's own doc comment, which
 * is the bug under test. Every fixture below goes through here.
 */
const CLOSE = `*${"/"}`;
const OPEN = `/${"*"}*`;

describe("findEarlyTerminators", () => {
  it("flags a doc-comment line that closes the comment and keeps writing", () => {
    const source = [
      OPEN,
      ` * The glob is \`**${CLOSE}.ts\`, so this sentence becomes code.`,
      ` ${CLOSE}`,
      "export const x = 1;",
    ].join("\n");
    const found = findEarlyTerminators("lib/example.ts", source);
    assert.equal(found.length, 1);
    assert.equal(found[0].file, "lib/example.ts");
    assert.equal(found[0].line, 2);
    assert.ok(found[0].trailing.startsWith(".ts`, so this sentence"));
  });

  it("says nothing about a healthy comment", () => {
    const source = [OPEN, " * An ordinary paragraph.", ` ${CLOSE}`, "export const x = 1;"].join(
      "\n",
    );
    assert.deepEqual(findEarlyTerminators("lib/fine.ts", source), []);
  });

  it("leaves an inline block comment with code after it alone", () => {
    // `foo(/* flag */ true)` is legitimate and common. A rule that flagged it
    // would be a rule people turn off, and the line does not begin with a star.
    const source = `call(${OPEN.slice(0, 2)} flag ${CLOSE} true);`;
    assert.deepEqual(findEarlyTerminators("lib/inline.ts", source), []);
  });

  it("reports the column where the comment actually ended", () => {
    const line = ` * see \`**${CLOSE}.ts\` for the shape`;
    const found = findEarlyTerminators("lib/col.ts", [OPEN, line, ` ${CLOSE}`].join("\n"));
    assert.equal(found[0].column, line.indexOf(CLOSE) + 1);
  });

  it("finds every occurrence, not only the first", () => {
    const bad = ` * one \`**${CLOSE}.ts\` here`;
    const found = findEarlyTerminators("lib/many.ts", [OPEN, bad, " * fine", bad, ` ${CLOSE}`].join("\n"));
    assert.deepEqual(
      found.map((entry) => entry.line),
      [2, 4],
    );
  });

  it("truncates a long trailing fragment rather than quoting a paragraph", () => {
    const tail = "x".repeat(TRAILING_LIMIT * 2);
    const found = findEarlyTerminators("lib/long.ts", [OPEN, ` * ${CLOSE}${tail}`, ` ${CLOSE}`].join("\n"));
    assert.equal(found[0].trailing.length, TRAILING_LIMIT + 1, "expected the ellipsis to be added");
    assert.ok(found[0].trailing.endsWith("…"));
  });

  it("finds nothing in a file with no comments at all", () => {
    assert.deepEqual(findEarlyTerminators("lib/plain.ts", "export const x = 1;\n"), []);
  });
});

describe("formatEarlyTerminatorReport", () => {
  it("is empty when there is nothing to say", () => {
    assert.equal(formatEarlyTerminatorReport([]), "");
  });

  it("names the file, the position, the fragment and what to do instead", () => {
    const report = formatEarlyTerminatorReport([
      { file: "lib/a.ts", line: 4, column: 12, trailing: ".ts`, so this way" },
    ]);
    assert.ok(report.includes("lib/a.ts"));
    assert.ok(report.includes("4:12"));
    assert.ok(report.includes(".ts`, so this way"));
    assert.ok(
      report.includes(EARLY_TERMINATOR_ADVICE),
      "the report and the CI annotation must carry the same one sentence",
    );
  });

  it("groups findings under their file", () => {
    const report = formatEarlyTerminatorReport([
      { file: "lib/a.ts", line: 1, column: 3, trailing: "x" },
      { file: "lib/a.ts", line: 9, column: 3, trailing: "y" },
      { file: "lib/b.ts", line: 2, column: 3, trailing: "z" },
    ]);
    assert.equal(report.split("\n").filter((line) => line.trim() === "lib/a.ts").length, 1);
    assert.ok(report.includes("lib/b.ts"));
  });
});

describe("the guard is wired into the fleet", () => {
  const guard = LINT_GUARDS.find(
    (entry) => entry.scriptPath === "scripts/check-comment-terminators.ts",
  );

  it("is in LINT_GUARDS, so lint:all and lint:ci run it", () => {
    assert.ok(guard, "scripts/check-comment-terminators.ts must be registered");
  });

  it("walks every root this repository writes prose in", () => {
    // Wider than the shipping-code guards on purpose: the hazard is a property
    // of doc comments, and the file that demonstrated it was in scripts/ —
    // which the hex and radius walks never read.
    const floor = SCANNED_FLOORS["check-comment-terminators"];
    assert.deepEqual(floor?.count?.roots, [
      "app",
      "components",
      "data",
      "lib",
      "scripts",
      SUITES_REL,
    ]);
  });
});

describe("the compiler's own report is why this exists", () => {
  it("reports the cause as syntax errors pointing at prose", () => {
    // The positive control for the WHOLE rule: not that tsc misses this — it
    // does not — but that what it says names a column inside an English
    // sentence and never mentions the comment. Were tsc to start diagnosing
    // this directly, the guard would be redundant and this case would say so.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-terminator-"));
    try {
      const file = path.join(dir, "doc.ts");
      fs.writeFileSync(
        file,
        [OPEN, ` * \`include\` is \`**${CLOSE}.ts\`, so this way the paragraph`, " * becomes code.", ` ${CLOSE}`, "export const x = 1;"].join("\n"),
        "utf8",
      );
      let output = "";
      try {
        execFileSync(
          path.join(REPO_ROOT, "node_modules", ".bin", "tsc"),
          ["--noEmit", "--skipLibCheck", file],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
        );
      } catch (error) {
        output = (error as { stdout?: string }).stdout ?? "";
      }
      assert.ok(output.length > 0, "expected tsc to reject the fixture");
      assert.ok(
        /error TS\d+/.test(output),
        `expected syntax errors from tsc; got:\n${output}`,
      );
      // The MESSAGES only. The fixture's own directory is named after this
      // guard, so scanning the whole output would match the path rather than
      // anything tsc said — which is how the first version of this case failed.
      const messages = [...output.matchAll(/error TS\d+: (.*)/g)].map((match) => match[1]);
      assert.ok(messages.length > 0, `no messages parsed out of:\n${output}`);
      assert.ok(
        !messages.some((message) => /comment/i.test(message)),
        `tsc now explains the comment itself, which would make this guard redundant:\n${messages.join("\n")}`,
      );
      // And the rule names it in one line.
      const found = findEarlyTerminators("doc.ts", fs.readFileSync(file, "utf8"));
      assert.equal(found.length, 1);
      assert.equal(found[0].line, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
