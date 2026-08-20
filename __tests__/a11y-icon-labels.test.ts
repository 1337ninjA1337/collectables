import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readRepoFile as read } from "./helpers/repo-file";

/**
 * The icon-only buttons a screen reader could not name.
 *
 * A `<Pressable>` whose only child is an `<Ionicons>` has no text for an
 * assistive technology to read, so without an `accessibilityLabel` it is
 * announced as "button" and nothing else. Most of this app's icon buttons
 * carry one; a sweep for the ones that did not turned up three, and the bottom
 * navigation bar was the expensive one — six tabs, six identical unnamed
 * buttons, on the surface a non-visual user meets first and uses most.
 *
 * Pinned at source level because the components pull react-native and
 * `@expo/vector-icons` through the import graph, neither of which can be
 * transformed under `tsx --test`. A guard that would catch a FOURTH one
 * anywhere in the tree is the follow-up; these cases pin what was fixed so it
 * cannot quietly come back.
 */

describe("<NavTab> names itself", () => {
  const src = read("components/nav-tab.tsx");

  it("requires a label rather than accepting an unnamed tab", () => {
    // Required, not optional: an optional label is one a new tab can be added
    // without, which is exactly how the six got here.
    assert.match(src, /^  label: string;$/m);
    assert.doesNotMatch(src, /^  label\?: string;$/m);
    assert.match(src, /accessibilityLabel=\{item\.label\}/);
  });

  it("announces which tab you are on", () => {
    // The bar shows the active tab with a coloured icon and a dot. Neither
    // reaches a screen reader, so without this the tab you are standing on
    // announces exactly like the five you could navigate to.
    assert.match(src, /accessibilityState=\{\{ selected: item\.active \}\}/);
    assert.match(src, /accessibilityRole="button"/);
  });
});

describe("<BottomNav> localizes every tab label", () => {
  const src = read("components/bottom-nav.tsx");

  it("gives all six tabs a translated label", () => {
    // The two badged tabs wrap their name in `tabLabel(...)`, which swaps in a
    // badge-aware string; the plain name is still the `t()` call it starts
    // from, so it is still what this pins.
    for (const [key, call] of [
      ["home", 't("goHome")'],
      ["search", 't("searchTitle")'],
      ["marketplace", 't("marketplaceTitle")'],
      ["chats", 't("chatsTitle")'],
      ["friends", 't("friends")'],
      ["profile", 't("profile")'],
    ]) {
      const entry = new RegExp(
        `key: "${key}",\\s*\\n\\s*label: (tabLabel\\()?${call.replace(/[()"]/g, "\\$&")}`,
      );
      assert.match(src, entry, `the ${key} tab has no localized label`);
    }
  });

  it("speaks the badge the two badged tabs draw", () => {
    // A badge lives INSIDE the Pressable that carries the label, so a screen
    // reader announces "Chats, button" whether there are zero unread messages
    // or forty. Both badged tabs route their name through `tabLabel`, which
    // maps the badge — not the counter behind it — onto a localized string.
    for (const [key, badge] of [
      ["chats", "chatsBadge"],
      ["friends", "friendsBadge"],
    ]) {
      const entry = new RegExp(
        `key: "${key}",\\s*\\n\\s*label: tabLabel\\(t\\("\\w+"\\), ${badge}\\),`,
      );
      assert.match(src, entry, `the ${key} tab's label ignores its badge`);
    }
    // Derived from the badge rather than from `unreadTotal` a second time:
    // two readers of one counter is where the pill and the spoken name drift.
    assert.match(src, /navTabLabelSpec\(badge\)/);
    assert.match(src, /t\("navChatsUnreadA11y", \{ count: spec\.count \}\)/);
    assert.match(src, /t\("navFriendsRequestsA11y"\)/);
  });

  it("does not announce the pill's 99+ cap", () => {
    // `formatBadgeCount` caps at "99+" because the pill is 18px wide. A spoken
    // label has no width, so the label says the true count. Line comments are
    // stripped first — the code says WHY it does not call this, by name.
    const code = src.replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /formatBadgeCount/);
    assert.match(code, /count: spec\.count/);
  });

  it("hands the labels down already translated", () => {
    // `t()` lives in the screen, not in the tab: <NavTab> takes a string, so
    // one component reads the i18n context and the leaf stays presentational.
    const tab = read("components/nav-tab.tsx");
    assert.doesNotMatch(tab, /from "@\/lib\/i18n-context"/);
    assert.doesNotMatch(tab, /const \{ t \}/);
  });
});

describe("the leaf components whose icon sits next to its own name", () => {
  /**
   * Every `<Ionicons>` in these ten files, hidden on all three platforms.
   * They carried no hide at all, so every screen reader announced the glyph
   * beside a name that was already there. Each is safe to hide for a reason a
   * reader can check in the file: the `<Pressable>` wrapping it carries an
   * `accessibilityLabel`, or a sibling `<Text>` says the same thing in words,
   * or — for the two below — the meaning moved onto the `<Pressable>` as an
   * `accessibilityState` first.
   *
   * Not the whole sweep — 19 icons in 7 files still carry neither a hide nor a
   * label, and "decorative" is a judgement per site rather than a rule. These
   * are the ones where the judgement is written down next to them; the rest are
   * decomposed in `.tasks/.tasks.md`.
   */
  const DECORATIVE: readonly (readonly [string, number, string])[] = [
    ["components/nav-tab.tsx", 1, "the tab's own accessibilityLabel names it"],
    ["components/danger-icon-button.tsx", 1, "accessibilityLabel is a required prop"],
    ["components/soft-destructive-chip.tsx", 1, "the chip's <Text> is the name"],
    ["components/bottom-nav.tsx", 1, "the plus button carries plusLabel"],
    ["components/currency-input.tsx", 1, 'the chip carries t("currencyMore")'],
    ["components/visibility-badge.tsx", 1, "the badge's <Text>{label}</Text> is the name"],
    ["components/photo-lightbox.tsx", 3, "close / previous / next are each a named Pressable"],
    ["components/photo-preview.tsx", 3, "delete and the two reorder arrows are each named"],
    ["components/currency-sheet.tsx", 1, "the row's code + name <Text> name it"],
    ["components/item-filters.tsx", 6, "each chip carries a name or its own <Text>"],
  ];

  for (const [file, count, why] of DECORATIVE) {
    it(`${file} hides ${count} decorative icon(s) on all three platforms — ${why}`, () => {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      const tags = src.match(/<Ionicons[\s\S]*?\/>/g) ?? [];
      // The count is a fact about the file that no repo-wide rule can state:
      // a new icon added here inherits nothing from the ones already decided.
      assert.equal(tags.length, count, `${file} renders ${tags.length} <Ionicons>, expected ${count}`);
      for (const [i, tag] of tags.entries()) {
        // All three, because the two native props leave the web announcing it
        // and aria-hidden alone leaves iOS and Android announcing it:
        // <Ionicons> renders a <Text>, which unlike <View> does not derive the
        // native pair from aria-hidden.
        assert.match(tag, /accessibilityElementsHidden/, `${file} #${i}: no iOS hide`);
        assert.match(tag, /importantForAccessibility="no"/, `${file} #${i}: no Android hide`);
        assert.match(tag, /(?<![\w-])aria-hidden/, `${file} #${i}: no web hide`);
      }
    });
  }
});

describe("the two icon buttons the sweep found outside the nav bar", () => {
  it("<PhotoPreview> names both reorder arrows", () => {
    const src = read("components/photo-preview.tsx");
    assert.match(src, /accessibilityLabel=\{t\("photoMoveBack"\)\}/);
    assert.match(src, /accessibilityLabel=\{t\("photoMoveForward"\)\}/);
    // Two chevrons pointing opposite ways is the one case where a shared label
    // would be worse than none: "Move photo" twice tells a non-visual user
    // there are two buttons and nothing about which is which.
    assert.notEqual(
      /photoMoveBack/.source,
      /photoMoveForward/.source,
      "the two arrows must not share a label",
    );
  });

  it("<CurrencyInput> localizes the more-currencies chip instead of hardcoding English", () => {
    const src = read("components/currency-input.tsx");
    // It HAD a label — in English, for every one of the six languages. A
    // hardcoded label passes any check that only asks whether one is present,
    // which is why this pins the call rather than the attribute.
    assert.match(src, /accessibilityLabel=\{t\("currencyMore"\)\}/);
    assert.doesNotMatch(src, /accessibilityLabel="/, "no hardcoded English labels");
    assert.match(src, /import \{ useI18n \} from "@\/lib\/i18n-context";/);
  });
});

describe("the two glyphs that carried state, not decoration", () => {
  /**
   * Hiding an icon is only safe when what it says is said somewhere a screen
   * reader reaches. These two said something no `<Text>` beside them did — a
   * checkbox's checked-ness and a row's selected-ness — so the meaning moved
   * onto the `<Pressable>` as a role and an `accessibilityState` BEFORE the
   * glyph was hidden. Hiding them without that would have removed the only
   * copy.
   */

  it("item-filters' has-photos toggle is a checkbox with a checked state", () => {
    const src = read("components/item-filters.tsx");
    assert.match(src, /accessibilityRole="checkbox"/);
    assert.match(src, /accessibilityState=\{\{ checked: draft\.hasPhotos \}\}/);
    // The glyph swap is what the state replaces, so it must still be the thing
    // being hidden rather than a second, unrelated icon.
    assert.match(src, /name=\{draft\.hasPhotos \? "checkbox" : "square-outline"\}/);
  });

  it("the currency row says which code is selected", () => {
    const src = read("components/currency-sheet.tsx");
    assert.match(src, /accessibilityState=\{\{ selected: isSelected \}\}/);
    // Rendered only when selected, which is exactly why the state has to say
    // so: an unselected row has no checkmark to hide and nothing to announce.
    assert.match(src, /isSelected \? \(\s*<Ionicons/);
  });
});
