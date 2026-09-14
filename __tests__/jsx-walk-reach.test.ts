import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { jsxReach } from "@/lib/jsx-open-tag";
import { MARKUP_DIRS } from "@/lib/source-dirs";
import { stripComments } from "@/lib/strip-comments";

import { JSX_SUITE_SCAN_DIRS } from "./helpers/guard-scan-list";
import { readSuite } from "./helpers/suite-files";
import { sourceCode, tsxFiles } from "./helpers/source-files";

/**
 * How much of the app's markup the JSX rules actually read.
 *
 * FOUR SCANNERS reported a clean tree on 2026-09-14 while one of them was
 * reading nothing at all for `components/nav-tab.tsx`: an apostrophe in a line
 * comment inside an open tag opened a string that never closed, `openTagEnd`
 * ran off the end and returned -1, and `walkJsx` stops at a tag with no end
 * because it has nowhere to resume from. Nothing said so. "No findings" and
 * "no reading" print the same line, which is the failure mode this whole
 * repository's floors exist for and the one its floors could not see, because
 * they count FILES WALKED rather than markup understood.
 *
 * TWO ASSERTIONS, and each is useless without the other. No file truncates the
 * walk — which is also true of a walk that yields nothing — and the tree as a
 * whole yields at least as many tags as it did when this was measured.
 *
 * Deliberately a suite and not a `LINT_GUARDS` entry: the number is a fact
 * about this tree, it belongs beside the other measured floors, and a guard
 * would need a `SCANNED_FLOORS` entry whose subject is the same number twice.
 */

/**
 * The directories the JSX rules read: `lib/source-dirs.ts`'s markup roots.
 *
 * Hand-typed as `("app", "components")` for one commit; then derived, for one
 * more, by parsing `SCANNED_DIRS` out of the two script guards. Both were
 * answers to "which roots hold the markup these rules scan", which is now a
 * constant — and `guard-scan-dirs.test.ts` asserts both guards EQUAL it, so
 * the parse here was a second mechanism for a fact already pinned, and the
 * one that could go red on a reformat.
 *
 * A rule that widens widens the constant, and this floor follows.
 */
const SCANNED = MARKUP_DIRS;

/** Every `.tsx` that renders something, comment-blanked as the rules read it. */
const SCREENS = tsxFiles(...SCANNED);

/**
 * Opening tags across `app/` + `components/` on 2026-09-14: 1625 in 71 files.
 *
 * 1300 leaves 20% of the markup deletable, which is the same slack the walk
 * floors in `lib/scanned-floor.ts` keep. What it catches is the thing a file
 * count cannot: a primitive that quietly stopped understanding half the
 * attributes in this tree, with every rule over it still green.
 */
const TAG_FLOOR = 1300;

describe("the JSX walk reads the whole of every screen", () => {
  it("finds no file it has to give up inside", () => {
    // `unreadAt` is an offset into the comment-blanked source, so the line
    // number is the real one — which matters, because the answer to this
    // failure is always "go and look at that tag".
    const truncated = SCREENS.map((file) => {
      const code = sourceCode(file);
      const { unreadAt } = jsxReach(code);
      return unreadAt === null
        ? null
        : `${file}:${code.slice(0, unreadAt).split("\n").length}`;
    }).filter((entry): entry is string => entry !== null);

    assert.deepEqual(
      truncated,
      [],
      "an opening tag here never closes, so everything below it in that file is invisible to check-a11y-jsx, check-clarity-input-mask, check-empty-state-wrappers and the heading sweeps — all of which will report it clean",
    );
  });

  it("and reads at least as much markup as it did when this was measured", () => {
    // The floor under the case above. A walk that had stopped yielding
    // anything would satisfy "nothing truncates" perfectly.
    const tags = SCREENS.reduce((sum, file) => sum + jsxReach(sourceCode(file)).tags, 0);
    assert.ok(
      tags >= TAG_FLOOR,
      `the walk found ${tags} opening tags across ${SCREENS.length} screens, below the ${TAG_FLOOR} floor — either a lot of markup was deleted or the walk stopped understanding some of it`,
    );
  });

  it("walks every screen, so neither number is over a shrunken list", () => {
    assert.ok(SCREENS.length >= 55, `only ${SCREENS.length} .tsx files walked`);
  });

  it("covers the roots the suite-side rules read too", () => {
    // `empty-state-wrapper-audit` and the two heading sweeps walk this same
    // JSX from `__tests__/`, where there is no SCANNED_DIRS to parse. They
    // share one constant now, and this compares VALUES — it was a string
    // match on `tsxFiles("app", "components")` in each suite's source for one
    // commit, which is an assertion about spelling that a reformat turns red
    // and a constant turns green while nothing changed.
    const uncovered = JSX_SUITE_SCAN_DIRS.filter((dir) => !SCANNED.includes(dir));
    assert.deepEqual(
      uncovered,
      [],
      "a suite-side JSX rule reads a root this floor does not, so that directory's markup is watched by nothing",
    );
  });

  it("and the three suites take their roots from that one constant", () => {
    // The floor under the case above: comparing a constant against itself
    // proves nothing if the suites have stopped reading it.
    for (const suite of [
      "empty-state-wrapper-audit.test.ts",
      "modal-heading-role.test.ts",
      "screen-heading-role.test.ts",
    ]) {
      assert.match(
        readSuite(suite),
        /\.\.\.JSX_SUITE_SCAN_DIRS/,
        `${suite} names its own roots again instead of sharing the list`,
      );
    }
  });
});

describe("jsxReach itself", () => {
  it("reports the offset of the tag it gave up on", () => {
    const code = `<View />\n<Pressable style={{ flex: 1\n<Text>x</Text>`;
    const { unreadAt } = jsxReach(code);
    assert.equal(unreadAt, code.indexOf("<Pressable"));
  });

  it("counts what it read before giving up", () => {
    // Not zero: the walk is truncated, not empty, and a report that said
    // "read nothing" would send a reader to the wrong question.
    assert.equal(jsxReach(`<View />\n<Pressable style={{ flex: 1`).tags, 1);
  });

  it("reports null for a source it reached the end of", () => {
    const { tags, unreadAt } = jsxReach(`<View><Text>hi</Text></View>`);
    assert.equal(unreadAt, null);
    assert.equal(tags, 2);
  });

  it("counts a tag inside a render prop, which is where the reach was lost before", () => {
    assert.equal(jsxReach(`<Host render={() => (<Row />)} />`).tags, 2);
  });

  it("catches the apostrophe that started this, if the fix is ever undone", () => {
    // Comments NOT blanked on purpose: this is the raw shape, and the case
    // says the primitive survives it now rather than that stripComments hides
    // it. `components/nav-tab.tsx` is where it was real.
    const code = [
      "<Pressable",
      "  // the bar's own highlight says which tab you are on",
      '  accessibilityRole="button"',
      ">",
      '  <Ionicons name="x" />',
      "</Pressable>",
    ].join("\n");
    assert.deepEqual(jsxReach(code), { tags: 2, unreadAt: null });
    // And through the reader the rules actually use, which blanks it anyway.
    assert.equal(jsxReach(stripComments(code)).unreadAt, null);
  });
});
