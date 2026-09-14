import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertMatchesInEveryLocaleBody,
  assertNoLocaleDeclares,
} from "./helpers/i18n-locales";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile as read } from "./helpers/repo-file";
import { elementWith } from "./helpers/jsx-element-props";

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

/**
 * The visibility chip's whole JSX, opening tag and body.
 *
 * Was `/<Pressable[\s\S]*?key=\{v\}[\s\S]*?<\/Pressable>/`, written out six
 * times and refused by `lint:jsx-walk` since 2026-09-14: it starts at the
 * FIRST `<Pressable` in the screen and ends at the first `</Pressable>` after
 * the marker, so on a screen whose chip row sits inside another pressable it
 * was reading a different element's props entirely.
 */
function visibilityChip(source: string): string {
  return elementWith(source, "Pressable", /key=\{v\}/, "the visibility chip").text;
}

describe("visibility chip — locked private variant announces itself honestly", () => {
  it("create-collection: the chip declares no disabled state (it is not disabled — it opens the upsell)", () => {
    // A `disabled` key inside accessibilityState anywhere in the chip's JSX
    // would be exactly the lie this fix removed. The other Pressables in this
    // screen that legitimately announce disabled (the save button) use the
    // `disabled: saving` shape, which is scoped to the save row — the
    // visibility chip's JSX must not carry any `disabled:` in an
    // accessibilityState.
    const chip = visibilityChip(createSrc);
    assert.doesNotMatch(
      chip,
      /accessibilityState=\{\{[^}]*disabled\b/,
      "the visibility chip must not claim it is disabled — pressing it opens the upsell",
    );
  });

  it("create-collection: the chip announces its selected state", () => {
    const chip = visibilityChip(createSrc);
    assert.match(chip, /accessibilityState=\{\{\s*selected\s*\}\}/);
  });

  it("create-collection: the locked variant carries an accessibilityLabel naming Private and the premium constraint", () => {
    const chip = visibilityChip(createSrc);
    // The label is expression-shaped (a ternary over `locked`), so the guard's
    // untranslated-label rule (which matches bare double-quoted strings)
    // ignores it. The whole sentence is ONE composed key per locale
    // (`visibilityPrivateLockedA11y`) rather than a template joining two,
    // so a language whose punctuation is not English answers for its own
    // word order — Russian and Belarusian read the value+notice pair with
    // a colon rather than an em-dash — and the guard has no runtime string
    // concatenation to see through.
    assert.match(chip, /accessibilityLabel=\{\s*locked\s*\?\s*t\("visibilityPrivateLockedA11y"\)\s*:\s*undefined\s*\}/);
  });

  it("edit-collection-modal: the chip declares no disabled state either", () => {
    const chip = visibilityChip(modalSrc);
    assert.doesNotMatch(
      chip,
      /accessibilityState=\{\{[^}]*disabled\b/,
      "the edit modal chip must not claim it is disabled — pressing it fires a toast",
    );
  });

  it("edit-collection-modal: the chip announces its selected state", () => {
    const chip = visibilityChip(modalSrc);
    assert.match(chip, /accessibilityState=\{\{\s*selected\s*\}\}/);
  });

  it("edit-collection-modal: the locked variant carries an accessibilityLabel naming Private and the premium constraint", () => {
    const chip = visibilityChip(modalSrc);
    assert.match(chip, /accessibilityLabel=\{\s*locked\s*\?\s*t\("visibilityPrivateLockedA11y"\)\s*:\s*undefined\s*\}/);
  });
});

/**
 * The composed a11y sentence is a full-locale string, not a template joining
 * two keys — this pins that decision so a "tidying" pass cannot collapse it
 * back into `${t("visibilityPrivate")} — ${t("visibilityPrivatePremiumOnly")}`
 * for a screen reader user in a locale that punctuates the apposition
 * differently.
 */
describe("visibilityPrivateLockedA11y — every language declares the composed sentence directly", () => {
  it("is declared in every locale body rather than inherited via ...en", () => {
    // Asked of each locale map on its own — a whole-file count over the key's
    // name is exactly the shape `i18n-locales-helper.test.ts` retires, because
    // a base map declaring the key twice would satisfy a `.length === 6`
    // check while a non-base map inherited the English string.
    assertMatchesInEveryLocaleBody(
      readI18nSource(),
      /visibilityPrivateLockedA11y\s*:/,
      "visibilityPrivateLockedA11y is declared per locale",
    );
  });
});

/**
 * The chip's VISIBLE text and its spoken label have to agree in language.
 * The label went to a per-locale key first (`visibilityPrivateLockedA11y`),
 * and the four keys that draw the visible chip text and its hint below now
 * follow the same rule — so a Polish user sees "Prywatna" on the chip and
 * hears the Polish composed sentence from the label instead of "Private" on
 * the chip and a Polish sentence in the ear.
 */
describe("visibility chip text and hints — every locale declares its own text", () => {
  const src = readI18nSource();
  for (const key of [
    "visibilityPrivate",
    "visibilityPublic",
    "visibilityPublicHint",
    "visibilityPrivateHint",
  ]) {
    it(`${key} is declared in every locale rather than inherited from en`, () => {
      assertMatchesInEveryLocaleBody(
        src,
        new RegExp(`${key}\\s*:`),
        `${key} is declared per locale`,
      );
    });
  }
});

/**
 * `visibilityShared` was removed, and stays removed.
 *
 * It was a dead key — no screen rendered it (the badge reads `visibilityViewer`
 * for a shared-with-me collection and `visibilityPublic` for a public one) —
 * whose two declarations contradicted each other: "Shared" in `en` and
 * "Публичная" (Public) in `ru`, with the four other locales inheriting the
 * English one. Because nothing rendered it, no runtime assertion could catch
 * the contradiction; a source check is the only place it shows. This pins the
 * absence so a future edit re-adding a `visibilityShared` (contradictory or
 * not) has to explain itself rather than reviving a duplicate of
 * `visibilityViewer` by reflex.
 */
describe("visibilityShared — the dead, contradictory key stays deleted", () => {
  it("no locale declares visibilityShared", () => {
    assertNoLocaleDeclares(
      readI18nSource(),
      (key) => key === "visibilityShared",
      "visibilityShared was removed as a dead, self-contradictory duplicate " +
        "of visibilityViewer; use visibilityViewer (shared-with-me) or " +
        "visibilityPublic (public) instead",
    );
  });
});
