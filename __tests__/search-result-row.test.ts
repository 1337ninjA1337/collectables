import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Structural pins for `<SearchResultRow>` — the "picture, title, meta line"
 * row `components/search-overlay.tsx` drew three times (items, collections,
 * people) in twenty near-identical lines apiece.
 *
 * Two classes of pin, the same two `<SheetSearchRow>`'s suite makes:
 *   1. the component still renders the whole shape, since it is now the ONLY
 *      declaration — a regression here breaks all three sections at once;
 *   2. the overlay has not re-grown a private copy, which is how three
 *      copies drift apart in the first place.
 */

const COMPONENT = "components/search-result-row.tsx";
const CONSUMER = "components/search-overlay.tsx";

describe("components/search-result-row.tsx — markup", () => {
  const src = read(COMPONENT);

  it("is a pressable row with a picture, a title and a meta line", () => {
    const pressable = src.indexOf("<Pressable");
    const image = src.indexOf("<Image");
    const title = src.indexOf("{title}");
    const meta = src.indexOf("{meta}");
    assert.ok(pressable > 0 && image > 0 && title > 0 && meta > 0, "a row element is missing");
    assert.ok(pressable < image, "the row wraps the picture");
    assert.ok(title < meta, "the title leads the meta line");
  });

  it("names the row as a button, because the whole row navigates", () => {
    assert.match(src, /accessibilityRole="button"/);
  });

  it("falls back to an emoji when there is no picture", () => {
    // Three sections, three emoji, one placeholder frame. A row that rendered
    // an <Image> with an undefined uri shows a blank box on web and nothing
    // at all on iOS.
    assert.match(src, /\{photo \? \(/);
    assert.match(src, /\{fallbackEmoji\}/);
  });

  it("caps both lines at one, so a long title cannot push the meta off", () => {
    // The trailing `>` keeps this off the prop's mention in the header.
    assert.equal(src.split("numberOfLines={1}>").length - 1, 2);
  });

  it("takes the meta line as a node, because the items section nests a badge", () => {
    assert.match(src, /meta: ReactNode;/);
    assert.match(src, /export const SEARCH_RESULT_META_STYLE/);
  });

  it("is memoised, because the overlay re-renders on every keystroke", () => {
    assert.match(src, /memo\(function SearchResultRow/);
  });

  it("owns the one difference between a person and a thing", () => {
    // The avatar frame is a rounder radius and a warm fill; everything else
    // about the three sections is identical, which is the whole argument for
    // the component.
    assert.match(src, /avatar \? styles\.rowAvatar : styles\.rowThumb/);
  });
});

describe("components/search-overlay.tsx — the three copies are gone", () => {
  const src = read(CONSUMER);

  it("renders all three sections through the shared row", () => {
    assert.equal(
      src.split("<SearchResultRow").length - 1,
      3,
      "items, collections and people are the three sections",
    );
  });

  it("no longer declares the row's styles", () => {
    for (const style of [
      "styles.row",
      "styles.rowContent",
      "styles.rowThumb",
      "styles.rowThumbEmpty",
      "styles.rowThumbEmoji",
      "styles.rowAvatar",
      "styles.rowAvatarEmpty",
      "styles.rowText",
      "styles.rowTitle",
      "styles.rowMeta",
    ]) {
      assert.ok(
        !src.includes(style),
        `${CONSUMER} still reaches for ${style} — the row's styles belong to the component`,
      );
    }
  });

  it("hands the cost badge the shared meta style rather than a local copy", () => {
    assert.match(src, /<CostBadge item=\{item\} style=\{SEARCH_RESULT_META_STYLE\}/);
  });

  it("keeps the three section headings, which are the landmarks", () => {
    // The rows moved; the headers a screen-reader user jumps between did not.
    assert.equal(src.split('accessibilityRole="header"').length - 1, 3);
  });

  it("imports no <Image>, because nothing on the screen draws one any more", () => {
    assert.doesNotMatch(src, /^\s+Image,$/m);
  });
});
