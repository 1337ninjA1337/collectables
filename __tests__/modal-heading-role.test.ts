import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { headingTexts, isHeader, type HeadingText } from "./helpers/jsx-headings";
import { tsxFiles } from "./helpers/source-files";
import { JSX_SUITE_SCAN_DIRS } from "./helpers/guard-scan-list";

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
 * Empty since 2026-10-15, and the emptiness is the current state of the tree
 * rather than a rule nobody needed. It held `styles.rowTitle` for
 * `components/search-overlay.tsx`: a full-screen `<Modal>` whose results are
 * rows, where `rowTitle` is the name of the thing each row is about, and
 * marking those as headings would have put one heading per search result into
 * the rotor. The three sections' `sectionLabel`s carry the role instead.
 *
 * Those rows are `<SearchResultRow>` now — a component of its own, outside
 * every `<Modal>` subtree — so the scan below no longer reaches the style and
 * an entry for it would be an exemption for nothing. The claim did not go
 * with it: "a search result row is not a heading" is asked of the component
 * directly, in the case under the sections one, because that is where the
 * markup is.
 *
 * A modal that grows a row-shaped `…Title` of its own belongs back on this
 * list, with its reason.
 */
const NOT_A_HEADING: readonly string[] = [];

function isExempt(attrs: string): boolean {
  return NOT_A_HEADING.some((style) => attrs.includes(style));
}

describe("every modal heading is announced as a header", () => {
  const FOUND = tsxFiles(...JSX_SUITE_SCAN_DIRS).flatMap((file) => modalTitleTexts(file));

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
    // Asked of `<SearchResultRow>` rather than of the modal scan, because the
    // row moved out of the overlay's JSX and the claim did not move with it:
    // one heading per result would fill the rotor with the twenty items a
    // reader is trying to skip past to reach the two people.
    //
    // No `inModal` filter — the component IS the subtree, and whether its one
    // caller happens to be a `<Modal>` is not what makes a row a row.
    const rows = headingTexts("components/search-result-row.tsx", TITLE_STYLE);
    assert.ok(rows.length > 0, "the row component renders no title-styled text at all");
    for (const row of rows) {
      assert.ok(
        !isHeader(row),
        `${row.file}:${String(row.line)} is a search result row's title and carries the header role`,
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
