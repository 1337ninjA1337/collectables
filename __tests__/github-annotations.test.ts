import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  annotation,
  escapeAnnotationMessage,
  escapeAnnotationProperty,
  runningUnderActions,
} from "@/lib/github-annotations";
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
    const script = readRepoFile("scripts/check-audit-baseline.ts");
    assert.match(
      script,
      /runningUnderActions\(\)/,
      "the audit gate no longer decides when to annotate through the shared reader",
    );
    assert.match(
      script,
      /annotation\("warning",/,
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
