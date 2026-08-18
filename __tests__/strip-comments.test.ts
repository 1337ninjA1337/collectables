import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";
import { suiteFiles, suiteText } from "./helpers/suite-files";

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
