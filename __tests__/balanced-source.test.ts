import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { QUOTES, balancedEnd, balancedInner, balancedThrough, endOfString } from "@/lib/balanced-source";

import { readRepoFile } from "./helpers/repo-file";
import { assertNoOffenders, assertOnlyTheseMatch } from "./helpers/offence-sweep";
import { readSource, sourceFiles } from "./helpers/source-files";
import { readSuite, suiteFiles } from "./helpers/suite-files";

/**
 * The one balanced, quote-aware reader — and the three copies it replaced.
 *
 * `persist-effect-one-key.test.ts` wrote the stopping condition into its own
 * doc block: "when a second rule needs the same reader, that is the moment it
 * earns a module". A fourth rule needed it, so this is that module, and the
 * cases below are the ones no copy had:
 *
 *   - `check-empty-state-wrappers`'s copy was NOT quote-aware, so a `"}"`
 *     inside a string literal decremented its depth and ended the object early.
 *     Nothing in the style tables it reads contains one, which is why it has
 *     been correct so far and not why it is correct.
 *   - none of the three refused a `from` that is not the opening bracket, so
 *     an off-by-one in a caller's index arithmetic produced a plausible span
 *     read from the middle of the source rather than an error.
 */

describe("endOfString", () => {
  it("returns the index just past the closing quote", () => {
    const text = 'a "bc" d';
    assert.equal(endOfString(text, 2), 6);
    assert.equal(text.slice(2, 6), '"bc"');
  });

  it("skips an escaped quote inside the literal", () => {
    const text = '"a\\"b" tail';
    assert.equal(text.slice(0, endOfString(text, 0)), '"a\\"b"');
  });

  it("handles all three delimiters, and ignores the other two inside", () => {
    assert.equal(endOfString(`'a"b'`, 0), 5);
    assert.equal(endOfString("`a'b`", 0), 5);
    assert.equal(endOfString(`"a'b"`, 0), 5);
  });

  it("answers the end of the text for an unterminated literal, so a scan advances", () => {
    // A reader that answered `from` here would loop forever on broken source.
    const text = '"never closed';
    assert.equal(endOfString(text, 0), text.length);
  });

  it("QUOTES is exactly the three delimiters it skips", () => {
    assert.deepEqual([...QUOTES].sort(), ['"', "'", "`"]);
  });
});

describe("balancedEnd", () => {
  it("finds the closer of a nested pair", () => {
    const source = "f(a, g(b, c), d)";
    assert.equal(balancedEnd(source, 1, "(", ")"), source.length - 1);
  });

  it("does not balance on a delimiter inside a string literal", () => {
    // The bug the un-quote-aware copy shipped with: this `)` is not a closer.
    const source = 'f(a, ")", b)';
    assert.equal(balancedEnd(source, 1, "(", ")"), source.length - 1);
  });

  it("does not balance on a brace inside a string literal", () => {
    const source = '{ a: "}", b: 1 }';
    assert.equal(balancedEnd(source, 0, "{", "}"), source.length - 1);
  });

  it("answers null when the bracket never closes", () => {
    assert.equal(balancedEnd("f(a, b", 1, "(", ")"), null);
    // An unterminated literal swallows the rest, which is also "never closes"
    // rather than a span read to the end of the file.
    assert.equal(balancedEnd('f("a, b)', 1, "(", ")"), null);
  });

  it("refuses a `from` that is not the opening bracket", () => {
    // A caller bug, not a source one. Scanning from the middle of a span would
    // answer a plausible index for a question nobody asked.
    assert.throws(
      () => balancedEnd("f(a)", 0, "(", ")"),
      /not the opening/,
      "an index off by one must be an error, not a different span",
    );
    assert.throws(() => balancedEnd("f(a)", 99, "(", ")"), /end of source/);
  });
});

describe("balancedInner and balancedThrough", () => {
  const source = 'style={{ a: "}", b }}';
  const open = source.indexOf("{");

  it("inner excludes the brackets, through includes them", () => {
    assert.equal(balancedInner(source, open, "{", "}"), '{ a: "}", b }');
    assert.equal(balancedThrough(source, open, "{", "}"), '{{ a: "}", b }}');
  });

  it("both answer null for a span that never closes", () => {
    assert.equal(balancedInner("f(a", 1, "(", ")"), null);
    assert.equal(balancedThrough("f(a", 1, "(", ")"), null);
  });
});

// --- Adoption: the copies must not come back ---

describe("nothing keeps a private balanced reader", () => {
  /**
   * A local declaration of the reader, by any of the three names the copies
   * used plus the generic shape. Named so the control below can hold it: a
   * sweep asserting an absence is satisfied perfectly by a rule that stopped
   * matching, and every real offender has just been deleted.
   */
  const PRIVATE_READER = /\bfunction\s+(?:balanced|balancedParens|balancedBraces|endOfString)\s*\(/;

  it("the rule still matches a copy of the reader", () => {
    for (const offender of [
      "function balanced(source: string, from: number) {",
      "function balancedParens(source: string, from: number) {",
      "function balancedBraces(text: string, openBrace: number) {",
      "function endOfString(text: string, from: number): number {",
    ]) {
      assert.ok(PRIVATE_READER.test(offender), `must flag: ${offender}`);
    }
    assert.ok(
      !PRIVATE_READER.test('import { balancedInner, endOfString } from "@/lib/balanced-source";'),
      "importing the shared reader is the fix, not the offence",
    );
  });

  it("exactly one module declares one, and it is this module", () => {
    // `assertOnlyTheseMatch` rather than an exemption: the half that rots
    // quietly is the sanctioned file that STOPPED declaring it — a hole
    // standing open with nothing about it looking stale — and an `exempt`
    // entry cannot express that half.
    assertOnlyTheseMatch({
      rule: PRIVATE_READER,
      files: sourceFiles(),
      read: readSource,
      expected: ["lib/balanced-source.ts"],
      subject: "modules",
      what: "declare a balanced/quote-aware source reader",
    });
  });

  it("no suite or suite helper declares one", () => {
    // Two of the three copies lived under `__tests__/`, so a sweep of `lib/`
    // alone would have watched the wrong tree.
    assertNoOffenders({
      rule: PRIVATE_READER,
      files: suiteFiles(),
      read: readSuite,
      exempt: ["balanced-source.test.ts"],
      subject: "suites",
      what: "declare their own balanced/quote-aware source reader — import it from @/lib/balanced-source",
    });
  });

  it("the exempt suite is this one, and it only names the reader in prose", () => {
    // The honesty half: an exemption that stopped needing to be one is a hole
    // standing open with nothing about it looking stale. This file is exempt
    // because it writes the offending declarations as FIXTURES, and a case
    // pins that they are fixtures rather than a fourth copy.
    const self = readSuite("balanced-source.test.ts");
    assert.ok(
      PRIVATE_READER.test(self),
      "the exemption must still be needed — if this suite stopped containing the shape, drop the exemption",
    );
    assert.doesNotMatch(
      self,
      /^function\s+(?:balanced|balancedParens|balancedBraces|endOfString)\s*\(/m,
      "the fixtures are string literals; a real declaration at the top level here would be the fourth copy",
    );
  });

  it("the three former copies now import the shared reader", () => {
    const ADOPTERS = [
      readRepoFile("lib", "check-empty-state-wrappers.ts"),
      readSuite("helpers/declared-shape.ts"),
      readSuite("persist-effect-one-key.test.ts"),
    ];
    for (const source of ADOPTERS) {
      assert.match(
        source,
        /from "@\/lib\/balanced-source"/,
        "each of the three files that held a copy must read from the module now",
      );
    }
  });
});
