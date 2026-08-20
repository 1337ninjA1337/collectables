import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readRepoFile as read } from "./helpers/repo-file";

/**
 * The locked "Private" visibility chip announces WHAT it is and WHY it will not
 * take the press, without lying about being disabled.
 *
 * The chip is not disabled — pressing it fires `premium_upsell_shown` and
 * opens the upsell sheet (create screen) or a toast (edit modal). An
 * `accessibilityState={{ disabled: locked }}` was the honest description of
 * how it LOOKS and a lie about what it DOES; a screen reader user offered the
 * button as "dimmed, private" got no reason for the dim and no cue that the
 * upsell would appear on press.
 *
 * The fix: keep `accessibilityState={{ selected }}` and drop `disabled: locked`
 * — the chip stays announced as a live button — and give the locked variant an
 * `accessibilityLabel` that names both the value and the premium constraint,
 * so a non-visual user hears "Private — Private collections are a premium
 * feature." instead of "Private". The unlocked variant still composes its
 * name from the `<Text>` child, unchanged.
 *
 * Two adoption points, one shape: `app/create-collection.tsx` (where the
 * chip opens `<PremiumUpsellSheet>`) and `components/edit-collection-modal.tsx`
 * (where it fires a toast). Both have to move together — a fix that reached
 * only one would leave the other announcing `disabled` for a button that is
 * not.
 */
const createSrc = read("app/create-collection.tsx");
const modalSrc = read("components/edit-collection-modal.tsx");

describe("visibility chip — locked private variant announces itself honestly", () => {
  it("create-collection: the chip declares no disabled state (it is not disabled — it opens the upsell)", () => {
    // A `disabled` key inside accessibilityState anywhere in the chip's JSX
    // would be exactly the lie this fix removed. The other Pressables in this
    // screen that legitimately announce disabled (the save button) use the
    // `disabled: saving` shape, which is scoped to the save row — the
    // visibility chip's JSX must not carry any `disabled:` in an
    // accessibilityState.
    const chip = /<Pressable[\s\S]*?key=\{v\}[\s\S]*?<\/Pressable>/.exec(createSrc);
    assert.ok(chip, "visibility chip <Pressable key={v}> not found");
    assert.doesNotMatch(
      chip[0],
      /accessibilityState=\{\{[^}]*disabled\b/,
      "the visibility chip must not claim it is disabled — pressing it opens the upsell",
    );
  });

  it("create-collection: the chip announces its selected state", () => {
    const chip = /<Pressable[\s\S]*?key=\{v\}[\s\S]*?<\/Pressable>/.exec(createSrc);
    assert.ok(chip);
    assert.match(chip[0], /accessibilityState=\{\{\s*selected\s*\}\}/);
  });

  it("create-collection: the locked variant carries an accessibilityLabel naming Private and the premium constraint", () => {
    const chip = /<Pressable[\s\S]*?key=\{v\}[\s\S]*?<\/Pressable>/.exec(createSrc);
    assert.ok(chip);
    // The label is expression-shaped (a ternary over `locked`), so the guard's
    // untranslated-label rule (which matches bare double-quoted strings)
    // ignores it. Both t() calls must be there — one for the value name,
    // one for the premium notice — so a fix that dropped either half would
    // reduce a screen-reader user to "Private" again.
    assert.match(chip[0], /accessibilityLabel=\{\s*\n?\s*locked\s*\n?\s*\?/);
    assert.match(chip[0], /t\("visibilityPrivate"\)/);
    assert.match(chip[0], /t\("visibilityPrivatePremiumOnly"\)/);
    assert.match(chip[0], /:\s*undefined\b/);
  });

  it("edit-collection-modal: the chip declares no disabled state either", () => {
    const chip = /<Pressable[\s\S]*?key=\{v\}[\s\S]*?<\/Pressable>/.exec(modalSrc);
    assert.ok(chip, "visibility chip <Pressable key={v}> not found in edit modal");
    assert.doesNotMatch(
      chip[0],
      /accessibilityState=\{\{[^}]*disabled\b/,
      "the edit modal chip must not claim it is disabled — pressing it fires a toast",
    );
  });

  it("edit-collection-modal: the chip announces its selected state", () => {
    const chip = /<Pressable[\s\S]*?key=\{v\}[\s\S]*?<\/Pressable>/.exec(modalSrc);
    assert.ok(chip);
    assert.match(chip[0], /accessibilityState=\{\{\s*selected\s*\}\}/);
  });

  it("edit-collection-modal: the locked variant carries an accessibilityLabel naming Private and the premium constraint", () => {
    const chip = /<Pressable[\s\S]*?key=\{v\}[\s\S]*?<\/Pressable>/.exec(modalSrc);
    assert.ok(chip);
    assert.match(chip[0], /accessibilityLabel=\{\s*\n?\s*locked\s*\n?\s*\?/);
    assert.match(chip[0], /t\("visibilityPrivate"\)/);
    assert.match(chip[0], /t\("visibilityPrivatePremiumOnly"\)/);
    assert.match(chip[0], /:\s*undefined\b/);
  });
});
