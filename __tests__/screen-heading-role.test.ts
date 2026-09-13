import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { headingTexts, isHeader } from "./helpers/jsx-headings";
import { tsxFiles } from "./helpers/source-files";

/**
 * Every section heading on an ordinary SCREEN is announced as one.
 *
 * The rule next door covers modals, for a reason specific to sheets: a sheet
 * has no landmark of its own, so its title is the only thing saying where the
 * user now is. That reason is why the sweep started there — and it is not a
 * reason a screen needs none. A screen's headings are what the rotor is FOR:
 * VoiceOver and TalkBack both move by heading, and a profile with a
 * description, a collections list, a sale history and a wishlist under four
 * unmarked labels is one long swipe from top to bottom.
 *
 * Eighteen of them were plain `<Text>` when this was written — the whole of
 * settings, stats, marketplace, friends, the home screen, the profile screen
 * and the login screen. Nothing was wrong with any of them; nobody had a
 * reason to think about it, which is precisely the state the modal sweep found
 * its twelve in.
 *
 * ## Why `section…` and not every title
 *
 * A style called `section…` is a heading above a list BY CONSTRUCTION — that
 * is what this repository names them, and there is no second meaning for the
 * word here. `…Title` outside a modal is genuinely ambiguous: `styles.title`
 * on a screen is the page's own heading and `cardTitle`, `rowTitle` and
 * `itemTitle` are the names of things in a list, and marking those would put
 * one heading per row into the rotor — the exact failure the modal rule
 * exempts `search-overlay`'s rows for. Classifying them is a round of its own
 * with a human judgement per style, and a rule that shipped with fifteen
 * exemptions would be a list, not a rule.
 *
 * So this one has NO exemptions, deliberately. The day a `section…` style
 * turns out not to be a heading, the honest fix is to rename the style.
 */

/**
 * The style names that mean "a heading above a list".
 *
 * `sectionText` is the body copy UNDER one and is excluded for the same reason
 * `subtitle` is next door: claiming it would ask for two headings where the
 * design has one.
 */
const SECTION_STYLE = /styles\.section(?:Label|Title|Heading)\b/;

describe("every section heading on a screen is announced as a header", () => {
  const FOUND = tsxFiles("app", "components").flatMap((file) =>
    headingTexts(file, SECTION_STYLE),
  );

  it("finds the section headings at all", () => {
    // The floor every scanner here carries: a walk that silently matched
    // nothing proves its negative over an empty set.
    assert.ok(
      FOUND.length >= 18,
      `only ${String(FOUND.length)} section heading(s) found — the scan broke`,
    );
  });

  it("leaves none of them unannounced", () => {
    const unmarked = FOUND.filter((text) => !isHeader(text)).map(
      (text) => `${text.file}:${String(text.line)}`,
    );
    assert.deepEqual(
      unmarked,
      [],
      'a <Text> styled as a section heading must carry accessibilityRole="header" — a screen reader moves by heading, and an unmarked one is a line of text above a list',
    );
  });

  it("covers the screens a user meets most", () => {
    // Named so a deletion is visible: a scan over a tree is only as good as
    // the tree, and a screen that stopped rendering its section labels would
    // pass the case above by having nothing to check.
    const byFile = new Set(FOUND.map((text) => text.file));
    for (const file of [
      "app/index.tsx",
      "app/settings.tsx",
      "app/stats.tsx",
      "app/marketplace.tsx",
      "app/friends.tsx",
      "app/profile/[id].tsx",
      "components/login-screen.tsx",
    ]) {
      assert.ok(byFile.has(file), `${file} no longer renders a section heading`);
    }
  });

  it("reaches outside modals, which is the half the other rule could not see", () => {
    // The modal sweep filters to `inModal`, so every one of these was invisible
    // to it — not exempt, not classified, not looked at.
    const onScreens = FOUND.filter((text) => !text.inModal);
    assert.ok(
      onScreens.length >= 18,
      `only ${String(onScreens.length)} section heading(s) sit outside a modal — this rule exists for those`,
    );
  });

  it("reads the headings inside a render prop, which the walk used to step over", () => {
    // THE BUG THIS ROUND FOUND. `app/friends.tsx` renders both tab panels
    // through `<SwipeTabs renderTab={(key) => …}>`, so its two section labels
    // live INSIDE an open tag — and `openTagEnd` correctly reports that tag as
    // ending sixty lines later. The walk jumped the lot, the rule read the
    // file as having nothing to classify, and the same hole hid anything a
    // sheet renders through a render prop from the modal sweep next door.
    const friends = headingTexts("app/friends.tsx", SECTION_STYLE);
    assert.equal(
      friends.length,
      2,
      `friends renders 2 section headings and the walk found ${String(friends.length)}`,
    );
    for (const heading of friends) assert.ok(isHeader(heading));
  });

  it("reports offenders in the order a reader would find them", () => {
    // A render prop's children are collected while their parent tag is read,
    // so the raw order is not the file's.
    const lines = FOUND.filter((text) => text.file === "app/friends.tsx").map((text) => text.line);
    assert.deepEqual([...lines].sort((a, b) => a - b), lines);
  });

  it("does not claim the body copy under a heading", () => {
    assert.match("styles.sectionLabel", SECTION_STYLE);
    assert.match("styles.sectionTitle", SECTION_STYLE);
    assert.doesNotMatch("styles.sectionText", SECTION_STYLE);
    assert.doesNotMatch("styles.section", SECTION_STYLE);
  });
});
