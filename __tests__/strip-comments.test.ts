import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { codeOffsets, scanComments, scanSpans, stripComments } from "@/lib/strip-comments";

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
 * The three files that hold JavaScript inside a template literal, where a `//`
 * line is string content and the stripper is right to leave it standing.
 *
 * `lib/spa-fallback.ts` emits the service worker as a string;
 * `i18n-source.test.ts`'s fixtures are source the parser is asked to read; and
 * `check-a11y-jsx.test.ts` has a fixture that comments OUT an icon
 * button, which is the case proving that guard reads a commented-out
 * `<Pressable>` as prose. `lib/privacy-page.ts` was a fourth until the regex
 * fix landed — its survivor was a real comment below a pattern, not quoted
 * source, which is why the "still holds one" check below is worth having.
 */
const QUOTED_SOURCE: readonly string[] = [
  "check-a11y-jsx.test.ts",
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

  it("does not read a keyword reached through a `.` as a keyword", () => {
    // `p.return` is a PROPERTY NAME and ends an expression, so `p.return / 2`
    // divides. Recording `return` as the last word opened a regex and blanked
    // the rest of the line — after which the comment below survived into what
    // a guard reads as code, which is the failure this module exists to
    // prevent. `lib/i18n-source.ts` cleared the word after a member dot when
    // its scanner shipped; this module's smaller copy of the same tracking
    // never did, and shared the rule without sharing that.
    for (const access of ["a.return", "q.delete", "a?.return", "a . return", "o.typeof"]) {
      const stripped = stripComments(`const n = ${access} / 2; // gone\nconst b = 1;`);
      assert.ok(stripped.includes(`const n = ${access} / 2;`), access);
      assert.ok(!stripped.includes("gone"), `${access}: the comment survived as code`);
      assert.ok(stripped.includes("const b = 1;"), `${access}: the next line was eaten`);
    }
  });

  it("still opens a regex after a BARE keyword", () => {
    // The other direction, and the reason the word rule exists at all: clearing
    // the word too eagerly would make `return /}/` a division, read the `}` as
    // structure, and blank real code — a guard going silently blind rather than
    // loudly wrong.
    assert.ok(!stripComments("return /[a-z]/.test(s); // gone").includes("gone"));
    assert.ok(!stripComments("case /re/.test(s):  // gone").includes("gone"));
    // A word merely ENDING in a keyword is not one.
    assert.ok(stripComments("const n = myreturn / 2; // gone").includes("const n = myreturn / 2;"));
    assert.ok(!stripComments("const n = myreturn / 2; // gone").includes("gone"));
  });

  it("reads a numeric literal's last character, not a digit in the middle", () => {
    // The `.` inside `1.5` breaks the identifier run, so the digits after it
    // start a new one whose first character follows a `.` — the same shape as
    // a member access, and it must still divide. All four literal forms end in
    // a character `DIVISION_FOLLOWS` covers.
    for (const literal of [".5", "2.", "0x1f", "1_000n", "1e5"]) {
      const stripped = stripComments(`const n = ${literal} / 2; // gone\nconst b = 1;`);
      assert.ok(!stripped.includes("gone"), `${literal}: the comment survived`);
      assert.ok(stripped.includes("const b = 1;"), `${literal}: the next line was eaten`);
    }
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

/**
 * The span reader `stripComments` is now built on.
 *
 * It was extracted rather than written: the state machine had tracked comment,
 * string and regex modes for eleven callers already, and the only thing it did
 * not do was SAY where a comment was — which blanked text cannot, since a
 * comment and the spaces around it are the same characters. The alternative
 * was a second copy of it inside `lib/check-comment-terminators.ts`, whose
 * whole subject is comments read wrongly.
 *
 * The cases below are about the span boundaries specifically, because that is
 * the part `stripComments`' own suite cannot see: two spans that blank to the
 * same text can still end in different places, and the terminator rule reports
 * the place.
 */
describe("scanComments", () => {
  const CLOSE = `*${"/"}`;
  const OPEN = `/${"*"}*`;

  it("gives a line comment a span that stops before its newline", () => {
    const source = "const a = 1; // trailing\nconst b = 2;\n";
    const spans = scanComments(source);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].kind, "line");
    assert.equal(source.slice(spans[0].start, spans[0].end), "// trailing");
    assert.equal(source[spans[0].end], "\n", "the newline must stay outside the span");
    assert.equal(spans[0].closed, true);
  });

  it("ends a block comment one character past its terminator", () => {
    const source = `${OPEN}\n * body\n ${CLOSE}\nexport const x = 1;\n`;
    const spans = scanComments(source);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].kind, "block");
    assert.ok(source.slice(spans[0].start, spans[0].end).endsWith(CLOSE));
    assert.equal(source[spans[0].end], "\n");
  });

  it("marks an unterminated block comment unclosed and a trailing line comment closed", () => {
    const [block] = scanComments(`${OPEN}\n * runs off the end\n`);
    assert.equal(block.closed, false, "a block comment ends nowhere its author chose");
    const [line] = scanComments("const a = 1; // no newline after this");
    assert.equal(line.closed, true, "end of source closes a line comment legitimately");
  });

  it("reports nothing for a terminator inside a string or a regex literal", () => {
    // The two shapes that make a text scan for comments wrong, and the reason
    // this reader is the state machine rather than an `indexOf`.
    assert.deepEqual(scanComments(`const close = "${CLOSE}";\n`), []);
    assert.deepEqual(scanComments('const re = /["\']key["\']/;\nconst b = 2;\n'), []);
  });

  it("finds both comments of a file, in the order they open", () => {
    const source = `// first\n${OPEN}\n * second\n ${CLOSE}\n`;
    assert.deepEqual(
      scanComments(source).map((span) => span.kind),
      ["line", "block"],
    );
  });

  it("blanks exactly the spans it reports", () => {
    // The property that makes the extraction safe: `stripComments` is now
    // nothing but this reader plus a blanking rule, so every character it
    // changes is inside a span and every character it keeps is outside one.
    const source = readSource("lib/check-comment-terminators.ts");
    const stripped = stripComments(source);
    const inSpan = new Set<number>();
    for (const span of scanComments(source)) {
      for (let i = span.start; i < span.end; i++) inSpan.add(i);
    }
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") continue;
      const changed = stripped[i] !== source[i] || source[i] === " ";
      if (!inSpan.has(i)) {
        assert.equal(stripped[i], source[i], `character ${i} is outside every span but changed`);
      } else {
        assert.equal(stripped[i], " ", `character ${i} is inside a span and survived`);
        assert.ok(changed);
      }
    }
  });
});

/**
 * The full span reader — comments AND literals.
 *
 * `scanComments` is a filter over this, and the literals were already tracked
 * by the same machine; what changed is that they are now reported. The value
 * is the COMPLEMENT: everything outside every span is code, which is the only
 * way to ask whether a shape found by a text search is real. The first caller
 * is the rule that looks for a comment terminator standing in code — a thing
 * no valid program contains, and the wreckage every comment that ended early
 * leaves behind.
 */
describe("scanSpans", () => {
  const CLOSE = `*${"/"}`;
  const OPEN = `/${"*"}`;

  it("reports each literal kind with the terminator inside the span", () => {
    for (const [label, source] of [
      ["single", `const a = 'x ${CLOSE} y';\n`],
      ["double", `const a = "x ${CLOSE} y";\n`],
      ["template", `const a = \`x ${CLOSE} y\`;\n`],
    ] as const) {
      const spans = scanSpans(source);
      assert.equal(spans.length, 1, label);
      assert.equal(spans[0].kind, label);
      assert.equal(spans[0].closed, true, label);
      assert.ok(source.slice(spans[0].start, spans[0].end).includes(CLOSE), label);
    }
  });

  it("reports a regex literal, character class included", () => {
    // The class is the only place a pattern can hold the two characters
    // without the `/` of them ending it, so it is the only shape that tests
    // what this claims: `/a*\/b/` would simply be the pattern `/a*/` followed
    // by more code, and asserting on it would assert nothing about classes.
    const source = `const c = /[${"*"}${"/"}]/.test(s);\n`;
    const [span] = scanSpans(source).filter((entry) => entry.kind === "regex");
    assert.ok(span, "the pattern must be a span");
    assert.equal(source.slice(span.start, span.end), `/[${CLOSE}]/`);
    assert.equal(span.closed, true);
    assert.equal(
      codeOffsets(source)(source.indexOf(CLOSE)),
      false,
      "the terminator inside the class is content, not code",
    );
  });

  it("marks an unterminated quote unclosed and stops it before the newline", () => {
    const source = "const a = 'x\nconst b = 2;\n";
    const [span] = scanSpans(source);
    assert.equal(span.kind, "single");
    assert.equal(span.closed, false);
    assert.equal(source[span.end], "\n", "the newline that cut it is outside the span");
    // A template literal is the quote that MAY span lines, so the same shape
    // is closed rather than cut.
    const [tpl] = scanSpans("const a = `x\ny`;\n");
    assert.equal(tpl.kind, "template");
    assert.equal(tpl.closed, true);
  });

  it("is what scanComments filters, not a second walk", () => {
    const source = `// one\n${OPEN}* two ${CLOSE}\nconst a = "three";\n`;
    assert.deepEqual(
      scanComments(source),
      scanSpans(source).filter((span) => span.kind === "line" || span.kind === "block"),
    );
  });
});

describe("codeOffsets", () => {
  const CLOSE = `*${"/"}`;

  it("answers false inside every span and true in the code between them", () => {
    const source = `const a = "${CLOSE}"; // tail\n`;
    const inCode = codeOffsets(source);
    assert.equal(inCode(0), true, "`c` of const is code");
    assert.equal(inCode(source.indexOf(CLOSE)), false, "inside the string literal");
    assert.equal(inCode(source.indexOf("//")), false, "inside the line comment");
    assert.equal(inCode(source.indexOf(";")), true, "the semicolon between them");
  });

  it("is false outside the file rather than throwing", () => {
    const inCode = codeOffsets("const a = 1;\n");
    assert.equal(inCode(-1), false);
    assert.equal(inCode(9999), false);
  });

  it("takes a span list rather than rescanning, and agrees with the scan", () => {
    const source = readSource("lib/check-comment-terminators.ts");
    const spans = scanSpans(source);
    const shared = codeOffsets(source, spans);
    const rescanned = codeOffsets(source);
    for (let i = 0; i < source.length; i += 97) {
      assert.equal(shared(i), rescanned(i), `offset ${i} disagreed`);
    }
  });
});
