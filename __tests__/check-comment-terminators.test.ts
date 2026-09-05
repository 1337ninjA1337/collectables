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
 * The rule is narrow because a wider one would be disabled: an inline block
 * comment with code after it on the same line is untouched, and so is the JSX
 * expression container that holds nothing but a comment. Measured over this
 * tree: zero findings across 812 files, and it flags the real case.
 *
 * It reads COMMENT SPANS now rather than lines that begin with a star, which
 * is the difference many of the cases below are about: a continuation line
 * with no star prefix is in scope, a terminator inside a string literal is not
 * a terminator, and a file's SECOND broken comment is only reported when the
 * code the first one spilled into resynchronises.
 *
 * A SECOND rule stands behind the JSX exemption. The skip is defended by a
 * claim about English — that no orphaned paragraph begins with a brace — which
 * nobody can write a counter-example to without inventing it, and inventing it
 * is what the case below does. It reaches the exemption, the first rule says
 * nothing, and the ORIGINAL terminator the broken comment left standing in
 * code names the file anyway. Cause beats symptom where both are visible, so
 * the orphans of a file with an early finding are dropped.
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
  ORPHAN_TERMINATOR_ADVICE,
  TRAILING_LIMIT,
  earlyTerminatorAnnotations,
  findEarlyTerminators,
  findOrphanTerminators,
  formatEarlyTerminatorReport,
  formatOrphanTerminatorReport,
  orphanTerminatorAnnotations,
  orphansWithoutCause,
} from "../lib/check-comment-terminators";
import { isAnnotationLine } from "../lib/github-annotations";
import { LINT_GUARDS } from "../lib/lint-guards";
import { SCANNED_FLOORS } from "../lib/scanned-floor";
import { installedBin } from "./helpers/installed-packages";
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

  it("flags a continuation line that does not begin with a star", () => {
    // The gap the per-line version had, and the reason this rule reads spans:
    // an unprefixed continuation line is legal, is what a pasted-in paragraph
    // looks like before anything formats it, and carried the two characters
    // completely invisibly.
    const source = [
      OPEN.slice(0, 2),
      `   the include glob is \`**${CLOSE}.ts\`, and this is now code`,
      `   more prose`,
      ` ${CLOSE}`,
    ].join("\n");
    const found = findEarlyTerminators("lib/unprefixed.ts", source);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
    assert.ok(found[0].trailing.startsWith(".ts`, and this is now code"));
  });

  it("does not read a terminator inside a string literal as one", () => {
    // This module's own suite is full of them. The per-line rule was safe here
    // only because such a line never begins with a star.
    const source = [OPEN, " * A paragraph.", ` ${CLOSE}`, `const close = "${CLOSE}" + rest;`].join(
      "\n",
    );
    assert.deepEqual(findEarlyTerminators("lib/quoted.ts", source), []);
  });

  it("leaves a wrapped JSX comment container alone", () => {
    // `{/* … */}` is the only way to write a comment in JSX and prettier wraps
    // the long ones, so the brace after the terminator is the container's own.
    // Twelve of these are in this tree.
    const source = [
      `      {${OPEN.slice(0, 2)} One subscriber for every rejected write, above`,
      `          the gate so a sign-out does not unmount it. ${CLOSE}}`,
      "      <StorageNotice />",
    ].join("\n");
    assert.deepEqual(findEarlyTerminators("app/_layout.tsx", source), []);
  });

  it("still flags a stray terminator inside a JSX comment container", () => {
    // The exemption is the container shape, not the syntax: what follows a
    // real early terminator is the author's own paragraph, which does not
    // begin with a brace.
    const source = [
      `      {${OPEN.slice(0, 2)} the glob is`,
      `          \`**${CLOSE}.ts\`, so the rest of this is code ${CLOSE}}`,
      "      <StorageNotice />",
    ].join("\n");
    const found = findEarlyTerminators("app/broken.tsx", source);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
  });

  it("says nothing about a block comment that never closes", () => {
    // A different failure with a different diagnosis: the compiler names the
    // comment itself, and no fragment after it became code.
    const source = [OPEN, " * A paragraph that runs off the end of the file.", ""].join("\n");
    assert.deepEqual(findEarlyTerminators("lib/unclosed.ts", source), []);
  });

  it("finds a second broken comment once the code between them resynchronises", () => {
    // The honest limit of reading spans instead of lines: everything after an
    // early terminator is CODE, so whether a later comment is seen at all
    // depends on what that code does. Here the orphaned terminator on line 3
    // is read as a regex that ends at the newline, and the block on line 4
    // opens cleanly — so both are reported. A first offence that opens a
    // template literal would swallow the second, and the run that fixes one
    // reports the other.
    const source = [
      OPEN,
      ` * one \`**${CLOSE} tail one`,
      ` ${CLOSE}`,
      OPEN,
      ` * two \`**${CLOSE} tail two`,
      ` ${CLOSE}`,
    ].join("\n");
    assert.deepEqual(
      findEarlyTerminators("lib/many.ts", source).map((entry) => entry.line),
      [2, 5],
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

describe("findOrphanTerminators", () => {
  it("names a terminator standing in code", () => {
    // The wreckage of a comment that ended early: its ORIGINAL close is left
    // in what is now code, where no valid program puts one.
    const source = [OPEN, ` * glob is src${CLOSE}*.ts`, ` ${CLOSE}`, "export const x = 1;"].join(
      "\n",
    );
    const found = findOrphanTerminators("lib/wreck.ts", source);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 3);
    assert.ok(found[0].text.includes(CLOSE));
  });

  it("says nothing about a healthy file", () => {
    const source = [OPEN, " * An ordinary paragraph.", ` ${CLOSE}`, "export const x = 1;"].join(
      "\n",
    );
    assert.deepEqual(findOrphanTerminators("lib/fine.ts", source), []);
  });

  it("does not read a terminator inside a string, a template or a regex as one", () => {
    // Every one of these is ordinary content, and this suite writes the first
    // shape on nearly every line. A text scan for the two characters would
    // report all three.
    assert.deepEqual(findOrphanTerminators("lib/q.ts", `const a = "${CLOSE}";\n`), []);
    assert.deepEqual(findOrphanTerminators("lib/t.ts", `const b = \`x ${CLOSE} y\`;\n`), []);
    assert.deepEqual(findOrphanTerminators("lib/r.ts", `const c = /[${CLOSE}]/.test(s);\n`), []);
  });

  it("catches the broken JSX container the early rule's one exemption skips", () => {
    // The reason this rule exists. `{/* … */}` wrapped across lines is
    // legitimate, so the early rule skips a comment opened after a `{` whose
    // trailing text starts with `}` — and that skip was defended by a claim
    // about English, which nothing can check. Here the skip fires on a REAL
    // early terminator, the early rule reports nothing, and the orphan its
    // comment left behind names the file anyway.
    const source = [
      `      {${OPEN.slice(0, 2)} the include list is every ts file under`,
      `          src, written out as src${CLOSE} } .ts and the rest is prose ${CLOSE}}`,
      "      <Foo />",
    ].join("\n");
    assert.deepEqual(
      findEarlyTerminators("app/x.tsx", source),
      [],
      "this case must reach the exemption — otherwise it is not testing the hole",
    );
    const found = findOrphanTerminators("app/x.tsx", source);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
  });

  it("leaves a healthy wrapped JSX container alone", () => {
    const source = [
      `      {${OPEN.slice(0, 2)} One subscriber for every rejected write, above`,
      `          the gate so a sign-out does not unmount it. ${CLOSE}}`,
      "      <StorageNotice />",
    ].join("\n");
    assert.deepEqual(findOrphanTerminators("app/_layout.tsx", source), []);
  });
});

describe("orphansWithoutCause", () => {
  it("drops the symptoms of a file whose cause is already named", () => {
    // One offence reported twice — once by the terminator that ended the
    // comment, once by the close it orphaned — is one offence too many, and
    // only the first is the thing a reader can act on.
    const early = [{ file: "lib/a.ts", line: 2, column: 5, trailing: ".ts and prose" }];
    const orphans = [{ file: "lib/a.ts", line: 4, column: 2, text: `  ${CLOSE}` }];
    assert.deepEqual(orphansWithoutCause(early, orphans), []);
  });

  it("keeps an orphan in a file with no early finding", () => {
    const orphans = [{ file: "app/x.tsx", line: 2, column: 65, text: `prose ${CLOSE}}` }];
    assert.deepEqual(orphansWithoutCause([], orphans), orphans);
  });

  it("is per file, not per repository", () => {
    const early = [{ file: "lib/a.ts", line: 2, column: 5, trailing: "x" }];
    const orphans = [
      { file: "lib/a.ts", line: 4, column: 2, text: "a" },
      { file: "lib/b.ts", line: 7, column: 2, text: "b" },
    ];
    assert.deepEqual(
      orphansWithoutCause(early, orphans).map((entry) => entry.file),
      ["lib/b.ts"],
    );
  });
});

describe("formatOrphanTerminatorReport", () => {
  it("is empty when there is nothing to say", () => {
    assert.equal(formatOrphanTerminatorReport([]), "");
  });

  it("carries its own advice, not the early rule's", () => {
    const report = formatOrphanTerminatorReport([
      { file: "lib/a.ts", line: 4, column: 12, text: `prose ${CLOSE}` },
    ]);
    assert.ok(report.includes("lib/a.ts"));
    assert.ok(report.includes("4:12"));
    assert.ok(
      report.includes(ORPHAN_TERMINATOR_ADVICE),
      "an orphan's reader has to be told to look UP for the cause",
    );
    assert.ok(
      !report.includes(EARLY_TERMINATOR_ADVICE),
      "the glob sentence is about the other rule and would send this reader nowhere",
    );
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

/**
 * The half of this guard's output that had never been run.
 *
 * Both builders were private functions in `scripts/check-comment-terminators.ts`
 * until they moved here, which meant the only thing a suite could do about them
 * was read the script for an exact expression — a check on the spelling of the
 * code rather than on what it produces. This was the third module in the tree
 * emitting workflow commands and the only one whose output had never been past
 * `isAnnotationLine`, so nothing said its marks would reach a run summary at all.
 *
 * It is the output that matters most here, too: the compiler's own errors land
 * on the lines BELOW the comment that caused them, so without the annotation a
 * reviewer reading the diff sees complaints about code and nothing on the prose.
 */
describe("the annotations CI reads", () => {
  const EARLY = { file: "lib/a.ts", line: 4, column: 12, trailing: ".ts`, so this way" };
  const ORPHAN = { file: "lib/b.ts", line: 9, column: 1, text: "*/ and then some" };

  it("says nothing when there is nothing to say", () => {
    assert.deepEqual(earlyTerminatorAnnotations([]), []);
    assert.deepEqual(orphanTerminatorAnnotations([]), []);
  });

  it("emits one workflow command per finding, on the finding's own line", () => {
    // The location is the whole point of annotating this guard, so it is
    // asserted rather than the message: an annotation without `file`/`line`
    // lands on the summary and not on the diff, which is where the compiler
    // already failed to point.
    const [early] = earlyTerminatorAnnotations([EARLY, { ...EARLY, line: 7 }]);
    assert.equal(earlyTerminatorAnnotations([EARLY, { ...EARLY, line: 7 }]).length, 2);
    assert.match(early ?? "", /^::error file=lib\/a\.ts,line=4,col=12::/);
    assert.ok((early ?? "").includes(EARLY_TERMINATOR_ADVICE), "the mark drops the advice the report carries");

    const [orphan] = orphanTerminatorAnnotations([ORPHAN]);
    assert.match(orphan ?? "", /^::error file=lib\/b\.ts,line=9,col=1::/);
    assert.ok((orphan ?? "").includes(ORPHAN_TERMINATOR_ADVICE));
  });

  it("emits lines the shared classifier reads as workflow commands", () => {
    const lines = [...earlyTerminatorAnnotations([EARLY]), ...orphanTerminatorAnnotations([ORPHAN])];
    assert.equal(lines.filter(isAnnotationLine).length, 2);
    // Anti-vacuous: the human-readable reports this check prints alongside are
    // the lines a mark has to be distinguishable from, and they are prose.
    assert.ok(
      ![
        ...formatEarlyTerminatorReport([EARLY]).split("\n"),
        ...formatOrphanTerminatorReport([ORPHAN]).split("\n"),
      ].some(isAnnotationLine),
      "a human-readable report line is being classified as a workflow command",
    );
  });

  it("keeps the two messages apart, which is why there are two builders", () => {
    // Sharing one message would put a sentence about globs on a line whose
    // problem is a comment that ended above it. The advice sentences are the
    // half that must not cross over.
    const [early] = earlyTerminatorAnnotations([EARLY]);
    const [orphan] = orphanTerminatorAnnotations([ORPHAN]);
    assert.ok(!(early ?? "").includes(ORPHAN_TERMINATOR_ADVICE));
    assert.ok(!(orphan ?? "").includes(EARLY_TERMINATOR_ADVICE));
  });

  it("escapes a path that carries a property metacharacter", () => {
    // `:` and `,` separate one property from the next and the properties from
    // the message, so an unescaped one truncates the annotation rather than
    // failing. No repo file is named this way; the escaping still has to hold,
    // because a mark that silently loses its message is this module's own
    // failure mode.
    const [line] = earlyTerminatorAnnotations([{ ...EARLY, file: "lib/we:ird,name.ts" }]);
    assert.match(line ?? "", /^::error file=lib\/we%3Aird%2Cname\.ts,line=4,col=12::/);
    assert.ok(isAnnotationLine(line ?? ""));
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
          installedBin("tsc"),
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
