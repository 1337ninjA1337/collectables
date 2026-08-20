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
