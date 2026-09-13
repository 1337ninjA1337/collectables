import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { headingTexts, isHeader, type HeadingText } from "./helpers/jsx-headings";
import { tsxFiles } from "./helpers/source-files";

/**
 * Every heading inside a modal is announced as one.
 *
 * A sheet that slides up over a screen gives an assistive technology no
 * landmark of its own: the title is the only thing that says where the user
 * now is, and until it carries `accessibilityRole="header"` it is one more
 * line of text above a list. VoiceOver and TalkBack both navigate by heading;
 * without the role there is nothing to navigate to, and the way out of a
 * 160-row currency list is to swipe through it.
 *
 * THE CLASSIFICATION IS THE RULE, not the count. A `Title`-styled `<Text>`
 * inside a `<Modal>` is either a heading — and then it says so — or it is a
 * row's label that happens to be named `…Title`, and then it is listed below
 * with the reason. A new modal that ships an unclassified one turns this red,
 * which is the only way a rule like this stays true: the previous eleven were
 * all written by people who had no reason to think about it.
 *
 * Why a scan and not eleven hard-coded assertions: eleven assertions pass
 * forever and say nothing about the twelfth sheet. The scan is over the same
 * two roots `check-a11y-jsx` walks, and the same two primitives, because the
 * thing that is hard here is finding where a JSX open tag ENDS — the obvious
 * `/<Text([\s\S]*?)>/` stops at the first `>` in an arrow function.
 */

/**
 * A style name this repository gives a heading.
 *
 * `styles.title` exactly, or anything ending in `Title` — `sheetTitle`,
 * `modalTitle`, `shareTitle`, `rowTitle`. NOT `subtitle`, which is a second
 * line under a heading and never a heading itself; matching it would be
 * asking for two headers where the design has one.
 *
 * A SECTION LABEL IS THE OTHER SHAPE A HEADING TAKES HERE, and leaving it out
 * is how the search overlay ended up with no landmark at all: the file's only
 * `…Title` is `rowTitle`, which is correctly exempt, so the rule's verdict on
 * the whole file was "nothing to classify" while three section labels sat
 * above three lists of results. `styles.sectionLabel` and `styles.section`
 * with a suffix are matched for the same reason `sheetTitle` is — what the
 * style is CALLED is the only signal a scan has, and this repository names a
 * heading above a list `section…`. `sectionText` is the body copy under one,
 * excluded for exactly the reason `subtitle` is.
 */
const TITLE_STYLE = /styles\.(?:title|[A-Za-z0-9_]*Title|section(?:Label|Heading)?)\b/;

/**
 * Every heading-styled `<Text>` that sits inside a `<Modal>` subtree.
 *
 * The stack is what makes "inside a modal" answerable — a screen renders its
 * page content and its sheets in one file, and `app/item/[id].tsx`'s item
 * title is not a modal heading while its share sheet's title is — and it is
 * `helpers/jsx-headings.ts` that keeps it, because `screen-heading-role` asks
 * the same question of the same JSX outside a modal.
 */
function modalTitleTexts(file: string): HeadingText[] {
  return headingTexts(file, TITLE_STYLE).filter((text) => text.inModal);
}

/**
 * The `…Title` styles inside a modal that are NOT headings.
 *
 * `components/search-overlay.tsx` is a full-screen `<Modal>` whose results are
 * rows, and `rowTitle` is the name of the thing each row is about. Marking
 * those as headings would put one heading per search result into the rotor
 * and leave the overlay itself with none — the opposite of what the role is
 * for.
 *
 * That sentence used to be the whole story about this file, and the second
 * half of it was a description of the bug rather than of the design: the
 * overlay HAD no heading. Its three `sectionLabel`s carry the role now, so the
 * exemption is what it always claimed to be — a rule about rows, inside a file
 * that has landmarks of its own.
 */
const NOT_A_HEADING: readonly string[] = ["styles.rowTitle"];

function isExempt(attrs: string): boolean {
  return NOT_A_HEADING.some((style) => attrs.includes(style));
}

describe("every modal heading is announced as a header", () => {
  const FOUND = tsxFiles("app", "components").flatMap((file) => modalTitleTexts(file));

  it("finds the modal titles at all", () => {
    // The floor every scanner in this repository carries: a walk that silently
    // matched nothing proves its negative over an empty set.
    assert.ok(FOUND.length >= 10, `only ${String(FOUND.length)} modal title(s) found — the scan broke`);
  });

  it("classifies every one of them", () => {
    const unclassified = FOUND.filter(
      (text) => !isHeader(text) && !isExempt(text.attrs),
    ).map((text) => `${text.file}:${String(text.line)}`);
    assert.deepEqual(
      unclassified,
      [],
      'a <Text> styled as a title inside a <Modal> is either a heading — accessibilityRole="header" — or a row label listed in NOT_A_HEADING with the reason',
    );
  });

  it("does not make a heading of a search result row", () => {
    // The exemption is a claim about the tree too: if search-overlay's rows
    // ever DO get the role, this list is stale and says the opposite of what
    // the file does.
    const rows = FOUND.filter((text) => isExempt(text.attrs));
    assert.ok(rows.length > 0, "NOT_A_HEADING lists a style nothing renders any more");
    for (const row of rows) {
      assert.ok(
        !isHeader(row),
        `${row.file}:${String(row.line)} is listed as not a heading and carries the role`,
      );
    }
  });

  it("makes a heading of each section of search results", () => {
    // The three lists — items, collections, people — are one scroll, and the
    // rotor is how a screen-reader user skips twenty items to reach two
    // people. Named rather than counted: a section that stopped rendering its
    // label would pass the classification case by having nothing to classify.
    const headers = FOUND.filter(
      (text) =>
        text.file === "components/search-overlay.tsx" &&
        isHeader(text),
    );
    assert.equal(
      headers.length,
      3,
      `search-overlay announces ${String(headers.length)} of its 3 result sections as headers`,
    );
    for (const header of headers) {
      assert.match(header.attrs, /styles\.sectionLabel/);
    }
  });

  it("reads a section label as a heading and a section's body as not one", () => {
    // The matcher's two edges, held here rather than only in its doc block:
    // `sectionLabel` is the heading above a list, `sectionText` is the copy
    // under one — the same distinction `subtitle` is excluded for.
    assert.match("styles.sectionLabel", TITLE_STYLE);
    assert.match("styles.sectionTitle", TITLE_STYLE);
    assert.doesNotMatch("styles.sectionText", TITLE_STYLE);
    assert.doesNotMatch("styles.subtitle", TITLE_STYLE);
  });

  it("covers the sheets a user meets most", () => {
    // Named so a deletion is visible: a scan over a tree is only as good as
    // the tree, and a sheet that stopped rendering its title would pass the
    // classification case by having nothing to classify.
    const byFile = new Set(
      FOUND.filter(isHeader).map((text) => text.file),
    );
    for (const file of [
      "components/currency-sheet.tsx",
      "components/item-filters.tsx",
      "components/move-collection-modal.tsx",
      "components/edit-collection-modal.tsx",
      "components/share-sheet.tsx",
      "components/premium-upsell-sheet.tsx",
      "components/sold-listing-prompt.tsx",
      "app/wishlist.tsx",
      "app/create.tsx",
    ]) {
      assert.ok(byFile.has(file), `${file} no longer announces its sheet title as a header`);
    }
  });
});
