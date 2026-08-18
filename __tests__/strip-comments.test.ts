import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";
import { readSource, sourceFiles } from "./helpers/source-files";
import { readSuite, suiteFiles, suiteText } from "./helpers/suite-files";

/**
 * The comment stripper, on its own, with the properties its callers assume.
 *
 * It shipped inside `lib/env-inlining.ts` with no cases of its own — the env
 * scan's tests exercised it end to end, which covers the one caller and says
 * nothing about the ten others that arrived since. Four lint guards and seven
 * suites now depend on it for questions that have nothing to do with Metro's
 * `process.env` transform, and each depends on a different property: that
 * offsets survive (the guards report `file:line`), that string literals do NOT
 * (a guard's list of forbidden shapes is an array of strings), that a doc
 * comment quoting a retired shape is invisible to the rule that retired it.
 *
 * The last one is the whole reason the "said once" guards can state their rule
 * as "not at all" rather than as an exemption per file that explains itself.
 */

/**
 * The two files that hold JavaScript inside a template literal, where a `//`
 * line is string content and the stripper is right to leave it standing.
 *
 * `lib/spa-fallback.ts` emits the service worker as a string, and
 * `i18n-source.test.ts`'s fixtures are source the parser is asked to read.
 * `lib/privacy-page.ts` was a third until the regex fix landed — its survivor
 * was a real comment below a pattern, not quoted source, which is why the
 * "still holds one" check below is worth having.
 */
const QUOTED_SOURCE: readonly string[] = [
  "i18n-source.test.ts",
  "lib/spa-fallback.ts",
];

describe("stripComments", () => {
  it("blanks a line comment and keeps the code after it", () => {
    const source = "const a = 1; // note\nconst b = 2;";
    const stripped = stripComments(source);
    // Blanked, not deleted — asserted as the property rather than as a
    // hand-counted run of spaces, which is a thing to get wrong once.
    assert.equal(stripped.length, source.length);
    assert.ok(!stripped.includes("note"));
    assert.equal(stripped.split("\n")[0].trimEnd(), "const a = 1;");
    assert.equal(stripped.split("\n")[1], "const b = 2;");
  });

  it("blanks a block comment, including a multi-line one", () => {
    const stripped = stripComments("/**\n * doc\n */\nconst a = 1;");
    assert.ok(!stripped.includes("doc"));
    assert.ok(stripped.includes("const a = 1;"));
  });

  it("preserves length and every newline, so file:line still points at the source", () => {
    // The property the four lint guards depend on: they report a line number
    // computed from the stripped text and print the snippet from the original.
    const source = readRepoFile("lib/env-inlining.ts");
    const stripped = stripComments(source);
    assert.equal(stripped.length, source.length);
    assert.equal(stripped.split("\n").length, source.split("\n").length);
  });

  it("leaves a comment marker inside a string literal alone", () => {
    // The property the sweeps depend on: a guard's list of forbidden shapes is
    // an array of strings, and several of those shapes contain a slash.
    assert.equal(stripComments('const s = "// not a comment";'), 'const s = "// not a comment";');
    assert.equal(stripComments("const s = '/* also not */';"), "const s = '/* also not */';");
    assert.equal(stripComments("const s = `a // b`;"), "const s = `a // b`;");
  });

  it("honours an escaped quote rather than ending the string on it", () => {
    const source = 'const s = "a \\" // still string"; // gone';
    const stripped = stripComments(source);
    assert.ok(stripped.includes('"a \\" // still string"'));
    assert.ok(!stripped.includes("gone"));
  });

  it("ends an unterminated single-quoted string at the newline", () => {
    // Not a parser: a lone quote is far more likely to be an apostrophe in
    // prose than a string spanning the rest of the file, and treating it as
    // the latter would blind every rule below it.
    const stripped = stripComments("const a = 'oops\nconst b = 1; // note");
    assert.ok(stripped.includes("const b = 1;"));
    assert.ok(!stripped.includes("note"));
  });

  it("reads a regex literal as a pattern, not as an open string", () => {
    // The bug this closed. A single unpaired backtick or quote inside a
    // pattern put the stripper into string mode, and template mode does not
    // end at a newline — so everything below it, comments included, survived
    // into what a guard reads as code.
    const backtick = "assert.doesNotMatch(SRC, /`msg-\\$\\{Date\\.now\\(\\)\\}/);\n// gone\nconst a = 1;";
    const strippedBacktick = stripComments(backtick);
    assert.ok(!strippedBacktick.includes("gone"), "a comment below a regex with a backtick survived");
    assert.ok(strippedBacktick.includes("const a = 1;"));
    // The other half of the same shape, and the one that appears ~30 times
    // here: a character class holding both quote characters.
    const quotes = 'assert.match(block, /["\']source["\']/); // gone\nconst b = 2;';
    const strippedQuotes = stripComments(quotes);
    assert.ok(!strippedQuotes.includes("gone"), "a trailing comment after a quote-class regex survived");
    assert.ok(strippedQuotes.includes("const b = 2;"));
  });

  it("does not mistake a division for a regex, or eat the line after one", () => {
    // The failure in the other direction: reading `a / b` as an opening
    // pattern would blank real code until the next `/`, which is a guard going
    // silently blind rather than loudly wrong.
    const division = "const ratio = total / count; // gone\nconst c = 3;";
    const stripped = stripComments(division);
    assert.ok(stripped.includes("const ratio = total / count;"));
    assert.ok(!stripped.includes("gone"));
    assert.ok(stripped.includes("const c = 3;"));
    // And the keyword rows the shared rule carries: `return /re/` is a regex
    // even though `n` is an identifier character.
    assert.ok(!stripComments("return /[a-z]/.test(s); // gone").includes("gone"));
    // A `/` inside a character class does not close the pattern.
    assert.ok(!stripComments("const re = /[/]/; // gone").includes("gone"));
  });

  it("leaves no comment in the repository surviving as code", () => {
    // The sweep that found it, kept as the regression — and widened past the
    // suite directory, because half the twenty were in `lib/`: a sweep that
    // only walks `__tests__` would have documented the bug rather than found
    // it. Every `// ` line must differ from its stripped form, unless it is
    // JavaScript quoted INSIDE a template literal, which is a fixture (the
    // parser's) or an emitted artifact (the service worker) and not a comment
    // in the file that holds it.
    const survivors: string[] = [];
    const scan = (label: string, source: string) => {
      const stripped = stripComments(source).split("\n");
      source.split("\n").forEach((line, index) => {
        if (!/^\s*\/\/ /.test(line) || stripped[index] !== line) return;
        survivors.push(`${label}:${index + 1}`);
      });
    };
    for (const relative of suiteFiles()) scan(relative, readSuite(relative));
    // `sourceFiles()` with no argument is every source directory, checked
    // against the tree by `source-files-helper.test.ts` — the literal list
    // this loop used to carry would have stopped covering a new one silently.
    for (const relative of sourceFiles()) scan(relative, readSource(relative));
    assert.deepEqual(
      survivors.filter(
        (where) => !QUOTED_SOURCE.some((holder) => where.startsWith(`${holder}:`)),
      ),
      [],
      `these comments survive stripping and reach every guard as code: ${survivors.join(", ")}`,
    );
    // And each holder still HOLDS quoted source — an entry that stopped would
    // be an exemption standing open, the same hole the sweeps' own lists have.
    for (const holder of QUOTED_SOURCE) {
      assert.ok(
        survivors.some((where) => where.startsWith(`${holder}:`)),
        `${holder} no longer quotes source in a template literal — drop it from the list`,
      );
    }
  });

  it("is what the suite readers are layered on rather than a second stripper", () => {
    // `bundle-premise.test.ts` had its own two-regex version, which deleted
    // rather than blanked (so offsets moved) and would have eaten a string
    // containing `/*`. It is this one now.
    assert.equal(
      suiteText("bundle-premise.test.ts").includes("const stripComments = (source: string)"),
      false,
      "a suite declares its own comment stripper again",
    );
    const helper = readRepoFile("__tests__/helpers/suite-files.ts");
    assert.match(helper, /from "@\/lib\/strip-comments"/);
  });

  it("leaves no suite or guard importing it from the bundling module", () => {
    // The move's point: `lib/env-inlining.ts` is about Metro's
    // `process.env.EXPO_PUBLIC_*` transform, and ten importers had nothing to
    // do with bundling. A reader deleting its last bundle caller should not
    // have to discover that six guards go red.
    const offenders = suiteFiles().filter((relative) =>
      /stripComments[^;]*from "[^"]*env-inlining"/.test(suiteText(relative)),
    );
    assert.deepEqual(
      offenders,
      [],
      `these suites take stripComments from the bundling module: ${offenders.join(", ")}`,
    );
    for (const guard of [
      "lib/check-analytics-imports.ts",
      "lib/check-inline-radius.ts",
      "lib/check-empty-state-wrappers.ts",
      "lib/check-problem-phrasing-imports.ts",
    ]) {
      // Either spelling of the module — these four came in on the `@/` alias
      // and `env-inlining.ts` on the relative form, and each kept its own.
      assert.match(
        readRepoFile(guard),
        /from "(?:@\/lib|\.)\/strip-comments"/,
        `${guard} still goes via env-inlining`,
      );
    }
    // And the module it left still uses it, through the same one door.
    assert.match(readRepoFile("lib/env-inlining.ts"), /from "\.\/strip-comments"/);
  });
});
