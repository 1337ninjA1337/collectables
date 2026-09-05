import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ANNOTATION_LEVELS,
  annotation,
  escapeAnnotationMessage,
  escapeAnnotationProperty,
  isAnnotationLine,
  runningUnderActions,
} from "@/lib/github-annotations";
import { runAuditGate, skipRead, type AuditRead } from "@/lib/audit-baseline";
import { formatGitHubAnnotations } from "@/lib/check-inline-hex";

import { readRepoFile } from "./helpers/repo-file";
import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * Workflow commands, extracted from `check-inline-hex` when a second producer
 * arrived.
 *
 * The escapers were private to the hex scanner. The audit gate now annotates a
 * SKIP — the case for which is that a skip exits 0, so the one leg allowed to
 * read a live feed could decline to answer and leave nothing behind but a line
 * in a log nobody opens on a green run. Writing the five replacements a second
 * time is how two copies of one rule stop agreeing, so there is one copy.
 */

describe("escapeAnnotationMessage", () => {
  it("escapes what would end the line early", () => {
    // `%` first, or the escapes escape each other's output.
    assert.equal(escapeAnnotationMessage("100%"), "100%25");
    assert.equal(escapeAnnotationMessage("a\nb"), "a%0Ab");
    assert.equal(escapeAnnotationMessage("a\r\nb"), "a%0D%0Ab");
    assert.equal(escapeAnnotationMessage("%0A"), "%250A", "an existing escape must not be undone");
  });

  it("leaves the separators alone, which a message may contain", () => {
    // A message is everything after `::`, so a colon in it is just a colon.
    // This is the whole difference between the two escapers.
    assert.equal(escapeAnnotationMessage("ENOTFOUND: request failed, retrying"), "ENOTFOUND: request failed, retrying");
  });
});

describe("escapeAnnotationProperty", () => {
  it("escapes the separators as well, because a property ends at one", () => {
    // `,` ends a property and `:` ends the property list. Every check here
    // names itself with a colon, so a title is exactly where this bites.
    assert.equal(escapeAnnotationProperty("check: skipped"), "check%3A skipped");
    assert.equal(escapeAnnotationProperty("a,b"), "a%2Cb");
  });

  it("does everything the message escaper does, by doing it", () => {
    // Related by construction rather than by two lists that have to match: the
    // property escaper is the message escaper plus two replacements, and that
    // is what makes a change to one reach the other.
    for (const value of ["100%", "a\nb", "a\r\nb", "%0A"]) {
      assert.equal(escapeAnnotationProperty(value), escapeAnnotationMessage(value));
    }
  });
});

describe("annotation", () => {
  it("writes a bare command when there are no properties", () => {
    assert.equal(annotation("notice", "nothing to say"), "::notice::nothing to say");
  });

  it("writes the properties it was given and omits the rest", () => {
    // `file=` with nothing after it is a property GitHub tries to resolve, so
    // an absent property is absent rather than empty.
    assert.equal(
      annotation("warning", "careful", { title: "a title" }),
      "::warning title=a title::careful",
    );
    assert.equal(
      annotation("error", "here", { file: "lib/a.ts", line: 4, col: 9 }),
      "::error file=lib/a.ts,line=4,col=9::here",
    );
  });

  it("escapes the properties as properties and the message as a message", () => {
    const line = annotation("warning", "ENOTFOUND: it failed", { title: "gate: skipped" });
    assert.equal(line, "::warning title=gate%3A skipped::ENOTFOUND: it failed");
    // One `::` separator in the line, which is the property of it that the
    // escaping exists to keep true.
    assert.equal(line.split("::").length - 1, 2);
  });

  it("keeps a multi-line message on one line", () => {
    // A workflow command IS a line; a message with a newline in it would end
    // the command and leave the rest as ordinary log output.
    const line = annotation("warning", "first\nsecond", { title: "t" });
    assert.ok(!line.includes("\n"), "the annotation spans two lines");
    assert.match(line, /first%0Asecond/);
  });
});

describe("runningUnderActions", () => {
  it("is the exact string, not the presence of the variable", () => {
    // Locally the variable is unset; in other CI systems it can be set to
    // something else, and a truthiness check would print workflow commands at
    // a runner that shows them raw.
    assert.equal(runningUnderActions({ GITHUB_ACTIONS: "true" }), true);
    assert.equal(runningUnderActions({ GITHUB_ACTIONS: "false" }), false);
    assert.equal(runningUnderActions({ GITHUB_ACTIONS: "1" }), false);
    assert.equal(runningUnderActions({}), false);
  });
});

describe("the two producers, related by the module rather than by a copy", () => {
  it("still formats a hex finding exactly as it did privately", () => {
    // The escapers moved out of `check-inline-hex`; this is the shape they
    // produced before they did, written out rather than derived, so the move
    // is checked against the old output and not against the new code.
    assert.deepEqual(
      formatGitHubAnnotations([
        { file: "app/a.tsx", line: 3, column: 12, value: "#ff00aa" },
      ]),
      [
        "::error file=app/a.tsx,line=3,col=12::Inline hex literal #ff00aa — route it through a named export from lib/design-tokens.ts",
      ],
    );
  });

  it("is what the audit gate reaches for when it skips", () => {
    // The gate's skip is the reason this module exists, and the annotation is
    // the half that survives a green run. A revert to a bare `console.log`
    // would leave every case above green.
    //
    // The gate's decisions moved into `lib/audit-baseline.ts`, so the skip is
    // RUN here: the script keeps the `runningUnderActions()` reading, and the
    // decision it hands that answer to is what produces the mark.
    const script = readRepoFile("scripts/check-audit-baseline.ts");
    assert.match(
      script,
      /underActions: runningUnderActions\(\),/,
      "the audit gate no longer decides when to annotate through the shared reader",
    );
    const skipped = runAuditGate({
      read: (): AuditRead => skipRead("refused", "registry unreachable"),
      checkName: "check-audit-baseline",
      underActions: true,
    });
    assert.ok(
      skipped.lines.some((line) => line.startsWith("::warning ")),
      "the audit gate's skip is a plain log line again, so a run that did not check advisories looks like one that did",
    );
  });
});

describe("one copy of the rule, which is what the module is for", () => {
  /** Every `lib/` and `scripts/` file except the module itself. */
  function everyoneElse(): readonly string[] {
    return sourceFiles("lib", "scripts").filter(
      (file) => !file.endsWith("lib/github-annotations.ts"),
    );
  }

  /**
   * The five replacement TEXTS a workflow-command escaper produces.
   *
   * Not a spelling check, which is what reading for `'"%3A"'` was: the quotes
   * around it were the guard's, and a copy written with single quotes or a
   * template literal walked past. What makes this a rule about behaviour is
   * that a percent-escape has to APPEAR in the source to be produced — there
   * is no computing `%3A` from a colon, only writing it — so the text is the
   * one handle a source-read gets on a thing with no runtime surface.
   *
   * All five, because a copy is not always a whole table: the message escaper
   * is three of them and the property escaper is those three plus two.
   */
  const ESCAPE_OUTPUTS = /%(?:25|0D|0A|3A|2C)\b/;

  it("is the only place the escape table is written", () => {
    // Three copies existed: `check-inline-hex` had both escapers, and
    // `check-comment-terminators` had both again — found when the module was
    // written, not by the entry that predicted only the env check.
    const copies = everyoneElse().filter((file) => ESCAPE_OUTPUTS.test(sourceCode(file)));
    assert.deepEqual(
      copies,
      [],
      "a workflow-command escape table has been written again — the property and message rules differ by two replacements and two copies stop agreeing",
    );
  });

  it("would see a copy however it was quoted", () => {
    // The three ways to write the same replacement, and the half-table that a
    // message-only escaper is. Asserted against the pattern rather than by
    // editing a file, because the guard above is the thing being measured and
    // a fixture on disk would be a fifth copy.
    for (const copy of [
      'value.replace(/:/g, "%3A")',
      "value.replace(/:/g, '%3A')",
      "value.replace(/:/g, `%3A`)",
      'v.replace(/%/g, "%25").replace(/\\n/g, "%0A")',
      "const COMMA_ESCAPE = '%2C';",
    ]) {
      assert.match(copy, ESCAPE_OUTPUTS, `a copy written as \`${copy}\` would go unnoticed`);
    }
    // And it does not fire on prose that merely mentions the idea, which is
    // why the scan reads code with its comments stripped.
    assert.doesNotMatch("escapes the colon and the comma", ESCAPE_OUTPUTS);
  });

  it("is the only place the Actions check is written", () => {
    // Three scripts decided when to annotate and each wrote the comparison.
    // Read from code with comments stripped, because this module's own doc
    // comment quotes the variable and so do two of the guards'.
    const copies = everyoneElse().filter((file) => /GITHUB_ACTIONS\s*===/.test(sourceCode(file)));
    assert.deepEqual(
      copies,
      [],
      "a script is deciding whether to annotate on its own again, so `runningUnderActions` is one reader of three",
    );
  });

  it("still formats a comment-terminator finding as it did privately", () => {
    // The migration compared byte for byte against the template it replaced,
    // including the two characters only the property escaper touches. Pinned
    // here so the equivalence outlives the run that measured it.
    assert.equal(
      annotation("error", "100% of it: a, b", { file: "lib/we:ird,name.ts", line: 1, col: 1 }),
      "::error file=lib/we%3Aird%2Cname.ts,line=1,col=1::100%25 of it: a, b",
    );
  });
});

/**
 * The other end of {@link annotation}, and the reason it is here rather than at
 * the five call sites that used to spell it.
 *
 * A gate returns its whole output as one list — log lines and workflow commands
 * together, because the caller prints them all — so something has to tell them
 * apart. Five cases in `audit-baseline.test.ts` did it with
 * `startsWith("::")`, which is a copy of half of `annotation`'s decision: where
 * the level goes, and whether a property list follows it before the closing
 * `::`. Two spellings of one format, kept in step by nobody.
 */
describe("isAnnotationLine", () => {
  it("recognises every level annotation can emit, with and without properties", () => {
    // Driven off ANNOTATION_LEVELS rather than the three written out, which is
    // why that array is the declaration and the type is derived from it: a
    // fourth level spelled only in a union is one `annotation` can emit and
    // this classifier cannot see.
    for (const level of ANNOTATION_LEVELS) {
      assert.ok(isAnnotationLine(annotation(level, "something happened")), `bare ${level}`);
      assert.ok(
        isAnnotationLine(annotation(level, "something happened", { title: "a check" })),
        `${level} with a title`,
      );
      assert.ok(
        isAnnotationLine(annotation(level, "x", { file: "lib/a.ts", line: 3, col: 9 })),
        `${level} with a location`,
      );
    }
  });

  it("leaves the sentence every check prints beside its annotation alone", () => {
    for (const line of [
      "check-audit-baseline: OK — no new high/critical advisories",
      "check: skipping (we stopped waiting) — npm printed nothing.",
      "",
    ]) {
      assert.ok(!isAnnotationLine(line), `treated a log line as a workflow command: ${line}`);
    }
  });

  it("does not read a quoted type annotation as a workflow command", () => {
    // Why it anchors on the levels and not on `::` alone. These guards quote
    // source back at people constantly, and a bare-`::` rule would classify a
    // reported offender as a mark and suppress it on a terminal run.
    for (const line of [
      "  lib/a.ts:3  const x: Record<string, string> = {};",
      "::not-a-level:: something",
      ":: warning:: spaced",
    ]) {
      assert.ok(!isAnnotationLine(line), `treated source as a workflow command: ${line}`);
    }
  });

  it("agrees with the gate about which of its own lines are marks", () => {
    // The pairing that makes this more than a regex test: the gate emits a log
    // line and a mark for the same skip, and the classifier has to split them
    // the way `underActions: false` already does. A run with no marks and a run
    // whose marks this cannot see look identical from outside.
    const skip = (underActions: boolean) =>
      runAuditGate({
        read: (): AuditRead => skipRead("refused", "npm reported an error"),
        checkName: "check",
        underActions,
      });
    assert.deepEqual(
      skip(true).lines.filter((line) => !isAnnotationLine(line)),
      skip(false).lines,
      "the lines this classifier calls prose are not the lines the gate prints when nothing is watching",
    );
    assert.equal(skip(true).lines.filter(isAnnotationLine).length, 1);
    assert.equal(skip(false).lines.filter(isAnnotationLine).length, 0);
  });
});
