/**
 * The reorder that used to happen in silence.
 *
 * A row is picked up and it dims; it lands and it is somewhere else. Both are
 * things you have to see. Reorder mode therefore had no feedback at all for a
 * screen-reader user — and once the keyboard actions landed, that user had a
 * route into the mode they could definitely reach and still nothing telling
 * them whether it had worked.
 *
 * `AccessibilityInfo.announceForAccessibility` is the mechanism and is not
 * interesting. The decision is: announce WHAT, and when to stay quiet. The
 * position has to be trustworthy before it is read aloud, because a listener
 * cannot glance at the list to correct a wrong number — so `announcedPosition`
 * returns nothing rather than a clamped guess, and this suite is mostly about
 * the cases where it does.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { announcedPosition } from "@/lib/drag-reorder";
import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertDeclaredInEveryLocale,
  assertMatchesInEveryLocaleBody,
} from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

const ANNOUNCEMENT_KEYS = ["reorderPickedUp", "reorderMoved"] as const;

describe("the position a screen reader is told", () => {
  it("is 1-based, because nobody says 'position 0 of 7'", () => {
    assert.deepEqual(announcedPosition(0, 7), { position: 1, total: 7 });
    assert.deepEqual(announcedPosition(6, 7), { position: 7, total: 7 });
  });

  it("says nothing when the row has no index", () => {
    // `getIndex()` returns undefined for a windowed row the list has not
    // placed. "Position NaN of 7" is the alternative.
    assert.equal(announcedPosition(undefined, 7), null);
  });

  it("says nothing when the index is outside the list", () => {
    // Reachable from the keyboard route: `index + delta` is computed before
    // anything clamps it, and at the ends it lands outside.
    assert.equal(announcedPosition(-1, 7), null);
    assert.equal(announcedPosition(7, 7), null);
  });

  it("says nothing when the index is not a whole row", () => {
    assert.equal(announcedPosition(1.5, 7), null);
    assert.equal(announcedPosition(Number.NaN, 7), null);
    assert.equal(announcedPosition(Number.POSITIVE_INFINITY, 7), null);
  });

  it("says nothing about an empty or impossible list", () => {
    assert.equal(announcedPosition(0, 0), null);
    assert.equal(announcedPosition(0, -3), null);
    assert.equal(announcedPosition(0, 2.5), null);
  });

  it("never reports a position past the total it reports", () => {
    // The property, rather than the six cases above: whatever comes back is
    // sayable as-is.
    for (let total = 0; total <= 5; total += 1) {
      for (let index = -2; index <= 6; index += 1) {
        const at = announcedPosition(index, total);
        if (at === null) continue;
        assert.ok(at.position >= 1 && at.position <= at.total, `${index} of ${total} → ${JSON.stringify(at)}`);
      }
    }
  });
});

describe("the announcement helper", () => {
  const src = () => readRepoFile("lib/reorder-announcement.ts");

  it("stays quiet whenever the position could not be established", () => {
    assert.match(src(), /const at = announcedPosition\(index, total\);\n\s*if \(!at\) return;/);
  });

  it("takes `t` as a parameter rather than calling the hook", () => {
    // It runs inside render callbacks and event handlers, where `useI18n()`
    // would be a rules-of-hooks violation.
    const code = src();
    assert.doesNotMatch(code, /useI18n/);
    assert.match(code, /export function announceReorder\(\s*\n\s*t: Translate,/);
  });

  it("accepts only the two keys it has translations for", () => {
    assert.match(src(), /export type ReorderAnnouncement = "reorderPickedUp" \| "reorderMoved";/);
  });
});

describe("both screens announce both moments", () => {
  const screens = [
    { screen: "app/index.tsx", rows: "ownedCollections", commit: "reorderOwnedCollections(moveItem" },
    { screen: "app/collection/[id].tsx", rows: "visibleItems", commit: "commitItemOrder(moveItem" },
  ] as const;

  for (const { screen, rows, commit: commitCall } of screens) {
    describe(screen, () => {
      const src = () => readRepoFile(screen);

      it("announces the pick-up on the long press", () => {
        assert.match(
          src(),
          new RegExp(`announceReorder\\(t, "reorderPickedUp", index, ${rows}\\.length\\);\\n\\s*drag\\(\\);`),
        );
      });

      it("announces the landing after a keyboard move", () => {
        assert.match(
          src(),
          new RegExp(`announceReorder\\(t, "reorderMoved", index \\+ delta, ${rows}\\.length\\);`),
        );
      });

      it("announces the landing after a drag, from the index the list reports", () => {
        // `to` rather than a re-derivation: the list already resolved which
        // slot the row fell into, and computing it twice is how the spoken
        // position and the visible one drift.
        assert.match(src(), /onDragEnd=\{\(\{ data, to \}\) => \{/);
        assert.match(src(), /announceReorder\(t, "reorderMoved", to, data\.length\);/);
      });

      it("announces after committing, never instead of committing", () => {
        // The announcement must not be able to swallow the write — an ordering
        // this pins because both live in the same two-line handler.
        const code = src();
        const commit = code.indexOf(commitCall);
        const speak = code.indexOf('announceReorder(t, "reorderMoved", index + delta');
        assert.ok(commit > 0, `expected \`${commitCall}\` in ${screen}`);
        assert.ok(speak > commit, "the keyboard route must write before it speaks");
      });
    });
  }
});

describe("the announcement copy", () => {
  it("is declared in every locale", () => {
    const src = readI18nSource();
    for (const key of ANNOUNCEMENT_KEYS) {
      assertDeclaredInEveryLocale(src, key);
    }
  });

  it("interpolates both numbers in every locale", () => {
    // A translation that dropped `total` would say "moved to position 3" —
    // true, and useless without knowing how many rows there are.
    const src = readI18nSource();
    for (const key of ANNOUNCEMENT_KEYS) {
      assertMatchesInEveryLocaleBody(
        src,
        new RegExp(`\\b${key}: \\(params\\?: TranslationParams\\) =>[^\`]*\`[^\`]*\\$\\{params\\?\\.position \\?\\? 1\\}[^\`]*\\$\\{params\\?\\.total \\?\\? 1\\}`),
        `${key} interpolates position and total`,
      );
    }
  });

  it("says words around the numbers, in each language", () => {
    // "3 / 7" would be read as "three slash seven". The string is spoken, so
    // it has to be a sentence.
    const src = readI18nSource();
    for (const key of ANNOUNCEMENT_KEYS) {
      assertMatchesInEveryLocaleBody(
        src,
        new RegExp(`\\b${key}: \\(params\\?: TranslationParams\\) =>[\\s\\S]{0,80}?\`[^\`]*[A-Za-zА-Яа-яЁёІіЎў]{3}`),
        `${key} is a spoken sentence, not a counter`,
      );
    }
  });
});
