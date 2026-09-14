import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  findJsxWalks,
  formatJsxWalkReport,
  jsxWalkAnnotations,
  JSX_WALK_OWNER,
} from "@/lib/check-jsx-walk";
import { isAnnotationLine } from "@/lib/github-annotations";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The scanner behind `npm run lint:jsx-walk`.
 *
 * It refuses the three ways of faking `lib/jsx-open-tag.ts`: a regex that
 * wildcards to the first `>` of a component tag, that same walk written out as
 * a character loop, and a string search for the element's `</Close>`. Three copies of that walk were merged into one module on
 * 2026-09-13 — two of them carrying the same render-prop bug, fixed an hour
 * apart — and what stopped a fourth was a paragraph in a header. The guard
 * found nine more the day it was written.
 *
 * EVERY FIXTURE HERE IS ASSEMBLED rather than typed out, which is the same
 * predicament `lib/check-comment-terminators.ts` records: this suite is inside
 * the tree the guard walks, and a case written literally would be a finding
 * about itself. So {@link wildcardTag} and {@link closeSearch} build the
 * offending text from pieces that are individually harmless, and the last case
 * in the file asserts that the assembly worked — a suite that had quietly
 * become its own offender would otherwise only be caught by `lint:all`, which
 * is not where anybody would look for the reason.
 */

/** The character that starts a tag, held apart so no fixture spells one out. */
const OPEN = "<";

/**
 * An open-tag regex of the banned shape, as source text.
 *
 * `wildcardTag("HeroBanner", "[\\s\\S]*?")` is what
 * `src.match(/<HeroBanner[\s\S]*?>/)` looks like to the scanner.
 */
function wildcardTag(name: string, wildcard: string, middle = "", tail = ""): string {
  return `${OPEN}${name}${middle}${wildcard}${tail}>`;
}

/** A close-tag string search of the banned shape, as source text. */
function closeSearch(method: string, name: string, quote = '"'): string {
  return `code.${method}(${quote}${OPEN}/${name}>${quote})`;
}

const walks = (source: string) => findJsxWalks("__tests__/x.test.ts", source);
const rules = (source: string) => walks(source).map((f) => f.rule);

describe("findJsxWalks — the open-tag regex", () => {
  it("flags every wildcard run this tree actually wrote", () => {
    // The four forms found on the first run, one per line so each is its own
    // finding rather than one match spanning them.
    const source = [
      wildcardTag("HeroBanner", "[\\s\\S]*?"),
      wildcardTag("Profiler", "[^>]*"),
      wildcardTag("Screen", ".*?"),
      wildcardTag("Card", ".*"),
    ].join("\n");
    assert.deepEqual(rules(source), [
      "open-tag-regex",
      "open-tag-regex",
      "open-tag-regex",
      "open-tag-regex",
    ]);
    assert.deepEqual(
      walks(source).map((f) => f.tag),
      ["HeroBanner", "Profiler", "Screen", "Card"],
    );
  });

  it("reaches over the middle of a real one, which is why it is lazy", () => {
    // `/<Link\b[^>]*\basChild\b[^>]*>/` — the shape that shipped. Two wildcard
    // runs, and the finding is ONE: the whole literal is a single fake walk.
    const found = walks(wildcardTag("Link", "[^>]*", "\\b[^>]*\\basChild\\b"));
    assert.equal(found.length, 1);
    assert.equal(found[0].tag, "Link");
  });

  it("reports the line the literal is on", () => {
    const source = ["const a = 1;", "", `const b = /${wildcardTag("Modal", "[^>]*")}/;`].join("\n");
    assert.deepEqual(
      walks(source).map((f) => f.line),
      [3],
    );
  });

  it("does not pair a tag on one line with a wildcard on the next", () => {
    // A regex literal cannot span a line break, so a `<Foo` here and a
    // `[^>]*>` several lines down are two unrelated things. The bound is what
    // stops the scan from inventing a finding out of them.
    assert.deepEqual(rules([`${OPEN}Foo`, "[^>]*>"].join("\n")), []);
  });

  it("reaches the `>` through a bit of anchoring text, which is the same walk", () => {
    // The bound the rule shipped without. Thirty-one call sites wrote the
    // wildcard and then a few characters before the `>`:
    // `/<FlatList[\s\S]*?windowSize=\{5\}[\s\S]*?\/>/` is the commonest here.
    assert.deepEqual(rules(wildcardTag("FlatList", "[\\s\\S]*?", "", "windowSize=\\{5\\}")), [
      "open-tag-regex",
    ]);
    // And the one that finds the element's end by its INDENTATION, which is
    // the same answer with a worse reason.
    assert.deepEqual(rules(wildcardTag("Pressable", "[\\s\\S]*?", "", "\\n {6}")), [
      "open-tag-regex",
    ]);
  });

  it("says nothing about a TypeScript type argument", () => {
    // `flushPendingQueue<ChatMessage>(pending, {…})` is a generic, and the
    // only thing separating it from JSX in text is the identifier character
    // before the `<`, which no tag has. A real finding from the day the bound
    // above was added.
    assert.deepEqual(rules(`assert.match(SRC, /flushPendingQueue${OPEN}ChatMessage>\\(x,\\s*\\{[\\s\\S]*?y/);`), []);
  });

  it("says nothing about a tag whose own `>` the author wrote", () => {
    // `/<I18nProvider>[\s\S]*?<DiagnosticsProvider>/` is a nesting assertion.
    // Its author already knows where that opening tag ends, so no wildcard is
    // being used to find it and the hazard cannot apply.
    assert.deepEqual(
      rules(`const r = /${OPEN}I18nProvider>[\\s\\S]*?${OPEN}DiagnosticsProvider>/;`),
      [],
    );
    // Reported as `<I18nProvide>` when this was a `(?!>)` in the pattern: the
    // lookahead let the NAME backtrack a character to satisfy itself.
    assert.deepEqual(
      walks(`const r = /${OPEN}I18nProvider>[\\s\\S]*?${OPEN}DiagnosticsProvider>/;`).map((f) => f.tag),
      [],
    );
  });

  it("says nothing about an HTML tag, which is a different kind of text", () => {
    // Three files in this tree genuinely parse generated HTML — the built
    // page's <h1>, the <head> a CSP meta is injected into, the </head> the SPA
    // fallback's marker must precede. None of jsx-open-tag's premises (brace
    // expressions, render props, component nesting) apply there, and the
    // lowercase name is the JSX convention rather than an exemption list.
    assert.deepEqual(rules(wildcardTag("h1", "[\\s\\S]*?")), []);
    assert.deepEqual(rules(wildcardTag("head", "[^>]*")), []);
  });

  it("says nothing about a precise regex that names the props it wants", () => {
    // `/<Profiler\s+id="selection-flatlist"\s+onRender=\{…\}\s*>/` is a real
    // assertion in this tree and is NOT a walk: it spells out the tag it
    // expects instead of wildcarding past whatever is there. Flagging it would
    // make the guard a rule against matching JSX at all.
    assert.deepEqual(
      rules(`const r = /${OPEN}Profiler\\s+id="x"\\s+onRender=\\{cb\\}\\s*>/;`),
      [],
    );
  });

  it("says nothing about JSX that is simply rendered", () => {
    // The overwhelming majority of `<Uppercase` in this repository. A rule
    // that fired on markup would be one nobody could keep.
    assert.deepEqual(
      rules(`${OPEN}View style={{ flex: 1 }}>${OPEN}Text>hi</Text></View>`),
      [],
    );
  });
});

describe("findJsxWalks — the open-tag loop", () => {
  /**
   * `openTagEnd`'s body, as source text.
   *
   * Assembled like everything else here: this suite is inside the tree the
   * guard walks, and the comparison written out is the offence.
   */
  const loopEnd = (depthVar: string) => `if (char ${"==="} ">" && ${depthVar} ${"==="} 0) return i;`;

  it("flags the pair that means `the opening tag ends here`", () => {
    // Two real ones: a shipping guard's `braceDepth` and a suite's `depth`.
    assert.deepEqual(rules([loopEnd("braceDepth"), loopEnd("depth")].join("\n")), [
      "open-tag-loop",
      "open-tag-loop",
    ]);
  });

  it("reports it without a tag name, because a loop ends whatever it is in", () => {
    assert.deepEqual(
      walks(loopEnd("depth")).map((f) => f.tag),
      ["(any tag)"],
    );
  });

  it("says nothing about a `>` test on its own", () => {
    // Ordinary text handling. A markdown blockquote reader does this.
    assert.deepEqual(rules(`if (trimmed ${"==="} ">") return blockquote;`), []);
  });

  it("says nothing about a depth counter on its own", () => {
    // `declared-shape` and `check-platform-pairs` count brackets in
    // TypeScript type text, which has nothing to do with a JSX tag.
    assert.deepEqual(
      rules(`if (char ${"==="} "(" || char ${"==="} "[") depth += 1;`),
      [],
    );
  });

  it("says nothing when the depth test is not the next thing after the `>`", () => {
    // `char === ">" && code[i - 1] !== "="` closes a GENERIC, and
    // `check-platform-pairs` is entitled to it. The rule is the adjacency.
    assert.deepEqual(
      rules(`if (char ${"==="} ">" && code[i - 1] !${"=="} "=" && depth > 0) close();`),
      [],
    );
  });
});

describe("findJsxWalks — the close-tag search", () => {
  it("flags a component close tag handed to a string search", () => {
    const source = [
      closeSearch("indexOf", "Modal"),
      closeSearch("lastIndexOf", "Pressable"),
      closeSearch("includes", "ToastProvider"),
      closeSearch("split", "Profiler"),
      closeSearch("search", "Screen"),
    ].join("\n");
    assert.deepEqual(rules(source), Array(5).fill("close-tag-search"));
    assert.deepEqual(
      walks(source).map((f) => f.tag),
      ["Modal", "Pressable", "ToastProvider", "Profiler", "Screen"],
    );
  });

  it("reads the single-quoted and backticked forms too", () => {
    assert.deepEqual(rules(closeSearch("indexOf", "Modal", "'")), ["close-tag-search"]);
    assert.deepEqual(rules(closeSearch("indexOf", "Modal", "`")), ["close-tag-search"]);
  });

  it("flags the interpolated form, which has no name to report", () => {
    // ``code.indexOf(`</${tag}>`)`` — the same first-close-wins answer with
    // the component in a variable. Reported without a tag name rather than
    // with the interpolation's source text, which would read as a component
    // called `${tag}`.
    const found = walks(`code.indexOf(\`${OPEN}/\${tag}>\`)`);
    assert.deepEqual(
      found.map((f) => ({ rule: f.rule, tag: f.tag })),
      [{ rule: "close-tag-search", tag: "(interpolated)" }],
    );
  });

  it("says nothing about an HTML close tag", () => {
    assert.deepEqual(rules(closeSearch("indexOf", "head")), []);
    assert.deepEqual(rules(closeSearch("indexOf", "h1")), []);
  });

  it("says nothing about a close tag that is only written, not searched for", () => {
    // A fixture string in a suite, or JSX in a screen. The offence is handing
    // it to a search, not having the characters in the file.
    assert.deepEqual(rules(`const fixture = "${OPEN}Modal>x</Modal>";`), []);
  });
});

describe("findJsxWalks — what it refuses to look at", () => {
  it("ignores both shapes inside a comment", () => {
    // Every doc comment ABOUT these rules contains them, including this
    // module's own header and `lib/jsx-open-tag.ts`'s, which quotes the regex
    // that motivated the whole thing.
    const source = [
      `// ${wildcardTag("HeroBanner", "[\\s\\S]*?")}`,
      "/*",
      ` * ${closeSearch("indexOf", "Modal")}`,
      " */",
    ].join("\n");
    assert.deepEqual(rules(source), []);
  });

  it("does NOT ignore them inside a string, where the whole offence lives", () => {
    // The mirror of the case above, and the reason string literals are left
    // alone: `indexOf("</Modal>")` hides its close tag in one.
    assert.deepEqual(rules(closeSearch("indexOf", "Modal")), ["close-tag-search"]);
  });

  it("exempts the module the walk belongs in", () => {
    const offender = closeSearch("indexOf", "Modal");
    assert.deepEqual(findJsxWalks(JSX_WALK_OWNER, offender), []);
    assert.deepEqual(findJsxWalks("lib/somewhere-else.ts", offender).length, 1);
  });

  it("sorts a file's findings by position, so a report reads down the file", () => {
    const source = [
      "const a = 1;",
      closeSearch("indexOf", "Modal"),
      `const b = /${wildcardTag("Card", "[^>]*")}/;`,
    ].join("\n");
    assert.deepEqual(
      walks(source).map((f) => f.line),
      [2, 3],
    );
  });
});

describe("the report and the annotations", () => {
  const found = walks(
    [closeSearch("indexOf", "Modal"), `const b = /${wildcardTag("Card", "[^>]*")}/;`].join("\n"),
  );

  it("says nothing at all when there is nothing to say", () => {
    assert.equal(formatJsxWalkReport([]), "");
    assert.deepEqual(jsxWalkAnnotations([]), []);
  });

  it("names the file, the rule, the tag and what to use instead", () => {
    const report = formatJsxWalkReport(found);
    assert.match(report, /Found 2 hand-rolled JSX scan\(s\)/);
    assert.match(report, /__tests__\/x\.test\.ts/);
    assert.match(report, /close-tag-search <Modal>/);
    assert.match(report, /open-tag-regex <Card>/);
    // The replacement, not a pointer to the module: a reader who has just been
    // told their line is banned wants the function name.
    assert.match(report, /closeTagIndex/);
    assert.match(report, /walkJsx or openTagAt/);
  });

  it("emits one workflow command per finding, in the form CI parses", () => {
    const lines = jsxWalkAnnotations(found);
    assert.equal(lines.length, 2);
    for (const line of lines) assert.ok(isAnnotationLine(line), line);
  });
});

describe("the suite is not its own offender", () => {
  it("assembles every fixture, so lint:jsx-walk stays green over this file", () => {
    // The one case that could not be written any other way. If a future
    // fixture is typed out literally it lands in the tree the guard walks, and
    // `lint:all` reports it as a finding in a test file — which is a confusing
    // place to start reading. This says it here instead.
    const self = "__tests__/check-jsx-walk.test.ts";
    assert.deepEqual(findJsxWalks(self, readRepoFile(self)), []);
  });

  it("and the module it tests is clean under its own rules", () => {
    // `lib/check-jsx-walk.ts` is not the exempt path — only `jsx-open-tag` is
    // — so its own patterns and its own prose have to survive it.
    const module = "lib/check-jsx-walk.ts";
    assert.deepEqual(findJsxWalks(module, readRepoFile(module)), []);
  });
});
