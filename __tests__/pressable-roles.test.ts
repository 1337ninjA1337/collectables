import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * The tappable that never says it is a button.
 *
 * Neither React Native's `<Pressable>` nor react-native-web's sets a default
 * `accessibilityRole` — checked in both sources — so a Pressable without one
 * announces as a generic element on all three platforms: a screen reader user
 * is told there is some text there, not that it can be pressed. A sweep on
 * 2026-08-20 found 152 of this tree's 194 interactive Pressables in that
 * state.
 *
 * This suite owns the SHARED COMPONENTS slice: a role added here is a role
 * added to every screen that renders them. The screens are decomposed into
 * four more sub-tasks in `.tasks/.tasks.md`; when the count reaches zero the
 * rule goes into `check-a11y-jsx` the way `undecided_icon` and
 * `silent_disabled` did, and this suite can be deleted in favour of it.
 *
 * Source-level because these components pull react-native and
 * `@expo/vector-icons` through their import graphs and cannot be mounted under
 * `tsx --test`.
 */

/** Every interactive `<Pressable>` open tag in a file, attribute text only. */
function interactivePressables(source: string): string[] {
  const code = stripComments(source);
  const tags: string[] = [];
  const re = /<Pressable\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let i = m.index + "<Pressable".length;
    let depth = 0;
    let end = -1;
    while (i < code.length) {
      const c = code[i];
      if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        i += 1;
        while (i < code.length) {
          if (code[i] === "\\") i += 2;
          else if (code[i] === quote) {
            i += 1;
            break;
          } else i += 1;
        }
        continue;
      }
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) {
        end = i;
        break;
      }
      i += 1;
    }
    if (end === -1) continue;
    const attrs = code.slice(m.index, end);
    // A Pressable with no `onPress` is a layout wrapper, not a control.
    if (/\sonPress\s*=/.test(attrs)) tags.push(attrs);
  }
  return tags;
}

/**
 * The shared components, with how many interactive Pressables each renders —
 * ALL of them, not just the ones this slice added a role to. Five of
 * `item-filters`' ten already carried one, and a case that counted only the
 * five would go green on a file that lost the other five.
 *
 * The count is the part no repo-wide rule can state: a new button added to one
 * of these inherits nothing from the ones already decided, and reddens here.
 */
const SHARED: readonly (readonly [string, number])[] = [
  ["components/bottom-nav.tsx", 6],
  ["components/login-screen.tsx", 5],
  ["components/item-filters.tsx", 10],
  ["components/bulk-bar.tsx", 3],
  ["components/currency-input.tsx", 2],
  ["components/swipe-tabs.tsx", 2],
  ["components/photo-preview.tsx", 3],
  ["components/reaction-bar.tsx", 1],
  ["components/selectable-item-row.tsx", 1],
];

describe("the shared components all say what they are", () => {
  for (const [file, count] of SHARED) {
    it(`${file} gives all ${count} of its Pressables a role`, () => {
      const tags = interactivePressables(read(file));
      assert.equal(
        tags.length,
        count,
        `${file} renders ${tags.length} interactive Pressables, expected ${count}`,
      );
      for (const [i, attrs] of tags.entries()) {
        assert.match(attrs, /accessibilityRole="/, `${file} #${i} announces as generic text`);
      }
    });
  }
});

describe("the roles that are not `button`", () => {
  it("a multi-select row is a checkbox that says whether it is checked", () => {
    // "button" would announce the tap and say nothing about whether the item
    // is in the selection, which is the whole state the row exists to show.
    const src = read("components/selectable-item-row.tsx");
    assert.match(src, /accessibilityRole="checkbox"/);
    assert.match(src, /accessibilityState=\{\{ checked: selected \}\}/);
  });

  it("a tab is a button that says it is selected, because RN has no tab role", () => {
    // `tab` is not in the AccessibilityRole union this app types against, so
    // the bar announces buttons of which one is selected. Same answer
    // `<NavTab>` settled on, now used by both of swipe-tabs' rows.
    const src = read("components/swipe-tabs.tsx");
    assert.equal((src.match(/accessibilityState=\{\{ selected: isActive \}\}/g) ?? []).length, 2);
    assert.doesNotMatch(src, /accessibilityRole="tab"/);
  });

  it("a backdrop and a tap-swallowing sheet wrapper are explicitly nothing", () => {
    // Neither is a control: `button` on a backdrop puts a full-screen focus
    // stop in front of the sheet, and on the wrapper it announces the sheet
    // itself as pressable. `none` is the decision written down, rather than
    // the absence of one — which is what an unset role looks like.
    for (const file of ["components/item-filters.tsx", "components/bottom-nav.tsx"]) {
      const src = read(file);
      assert.equal(
        (src.match(/accessibilityRole="none"/g) ?? []).length,
        2,
        `${file}: expected the backdrop and the sheet wrapper to opt out`,
      );
    }
  });

  it("the chips that can be chosen say which one is", () => {
    // A currency chip, a quick filter chip and a reaction chip all render an
    // "active" style and, before this, said nothing about it.
    assert.match(read("components/currency-input.tsx"), /accessibilityState=\{\{ selected: active \}\}/);
    assert.match(read("components/item-filters.tsx"), /accessibilityState=\{\{ selected: chip\.active \}\}/);
    assert.match(read("components/reaction-bar.tsx"), /accessibilityState=\{\{ selected: item\.mine \}\}/);
  });
});
