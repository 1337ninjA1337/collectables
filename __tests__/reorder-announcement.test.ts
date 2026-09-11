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
    { screen: "app/index.tsx", rows: "ownedCollectionsRef" },
    { screen: "app/collection/[id].tsx", rows: "visibleItemsRef" },
  ] as const;

  for (const { screen, rows } of screens) {
    describe(screen, () => {
      const src = () => readRepoFile(screen);

      it("hands the drag over, which is what earns the row a pick-up announcement", () => {
        // The announce-then-`drag()` ordering is `reorderActionProps`'s now
        // and is asserted by running it in reorder-actions.test.ts. What can
        // still go wrong here is a screen that never passes `drag` — a row
        // with no long press at all.
        assert.match(src(), /\bdrag(,|: isOwner \? drag : undefined,)/);
      });

      it("announces both moments through one pass-through callback", () => {
        // Which moment and which position are the module's answers; the screen
        // owns only `t`. A screen that named the key itself would be back to
        // choosing when to speak in two places.
        assert.match(
          src(),
          /announce: \(key, at, total\) => announceReorder\(t, key, at, total\),/,
        );
      });

      it("announces the landing after a drag, from the index it actually committed", () => {
        // It was `to` and `data.length` — the list's own answers — until
        // 2026-09-11, when the drag stopped committing the snapshot it was
        // handed. `plan.to` and `plan.rows.length` are the only numbers that
        // describe the order that was written: they equal the list's whenever
        // nothing changed underneath, and differ exactly when a merge landed
        // mid-gesture, which is the case the user cannot see to check.
        assert.match(src(), /onDragEnd=\{\(\{ data, to \}\) => \{/);
        assert.match(
          src(),
          /announceReorder\(t, "reorderMoved", plan\.to, plan\.rows\.length\);/,
        );
      });

      it("says nothing at all for a drag that resolved to no move", () => {
        // `planDragCommit` returns null for a row that left the list, a `to`
        // that is not a position, and a drop that lands where the row already
        // is. Announcing any of those reads out a move that did not happen.
        assert.match(src(), /if \(!plan\) return;/);
      });

      it("hands the announcement to the same call that hands over the writer", () => {
        // The ordering — write, then speak — is `reorderActionProps`'s now and
        // is asserted by running it in reorder-actions.test.ts. What can still
        // go wrong here is a screen that passes one callback and not the
        // other, leaving a move that is silent or an announcement of a move
        // that never happened.
        const code = src();
        const commit = code.indexOf("commit:");
        const announce = code.indexOf("announce: (key, at, total) =>");
        assert.ok(commit > 0, `expected a \`commit:\` callback in ${screen}`);
        assert.ok(announce > commit, `expected an \`announce:\` callback after it in ${screen}`);
        assert.match(code, new RegExp(`rows: \\(\\) => ${rows}\\.current,`));
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

describe("the live region is mounted at startup, not at the first announcement", () => {
  /**
   * A region created at the moment of the first announcement can be missed by
   * a screen reader that has not scanned that subtree yet — the one silence
   * the web spelling's clear-then-write cannot stage around. `app/_layout.tsx`
   * mounts it empty instead, which puts a platform call in the root layout and
   * makes the native no-op load-bearing.
   */
  it("is called from the root layout in an effect that runs once", () => {
    const layout = readRepoFile("app/_layout.tsx");
    assert.match(layout, /import \{ ensureLiveRegion \} from "@\/lib\/announce";/);
    // In an effect rather than in render: appending to `document.body` during
    // render is a side effect React may run twice or discard.
    assert.match(layout, /useEffect\(\(\) => \{[^}]*ensureLiveRegion\(\);\n\s*\}, \[\]\);/s);
  });

  it("resolves to something on native, where there is no region to mount", () => {
    // Metro serves one spelling per platform, so a name only the web half
    // exports is a crash at startup on iOS and Android — the exact failure
    // `lint:platform-pairs` exists to refuse. The native answer is a no-op,
    // and it has to be an EXPORTED one.
    const native = readRepoFile("lib/announce.ts");
    assert.match(native, /export function ensureLiveRegion\(\): void \{/);
    // Empty on purpose: the platform's own announcement channel is always
    // there. A body here would be a second mechanism nobody asked for.
    const body = /export function ensureLiveRegion\(\): void \{([\s\S]*?)\n\}/.exec(native)?.[1] ?? "";
    assert.equal(
      body.replace(/\/\/[^\n]*/g, "").trim(),
      "",
      "the native spelling grew a body — it is meant to do nothing",
    );
  });

  it("mounts through the layout rather than from the screens that reorder", () => {
    // Two screens announce; if either mounted the region itself, a user who
    // reordered on the other one would still hit the race.
    for (const screen of ["app/index.tsx", "app/collection/[id].tsx"]) {
      assert.doesNotMatch(
        readRepoFile(screen),
        /ensureLiveRegion/,
        `${screen} mounts the region itself — startup is the only place that removes the race`,
      );
    }
  });
});

describe("the reorder gate says why it closed", () => {
  /**
   * The actions vanish and a sighted owner sees the notice; a screen-reader
   * owner sees nothing at all.
   *
   * `reorderBlockedBySort` renders a `accessibilityRole="alert"` notice, which
   * announces itself on Android and on web and does NOT on iOS. It also lives
   * in the list header, which a user deep in a long collection has scrolled
   * past. So the transition is spoken as well — the same "indistinguishable
   * from a broken button" the notice exists for, in the one place the notice
   * cannot reach.
   */
  const screen = () => readRepoFile("app/collection/[id].tsx");

  it("announces the notice's own words, not a second sentence about it", () => {
    // Two phrasings for one state is two things to translate and one of them
    // to forget; the notice's key is already in all six locales.
    assert.match(screen(), /announceMessage\(t\("reorderBlockedBySort"\)\)/);
    assert.match(screen(), /import \{ announceMessage \} from "@\/lib\/announce";/);
  });

  it("speaks through the same door the reorder announcements use", () => {
    // Not `AccessibilityInfo` directly: on web that call is an empty function,
    // which is the whole reason `lib/announce.web.ts` exists.
    assert.doesNotMatch(screen(), /AccessibilityInfo/);
  });

  it("fires on the transition, not on every render", () => {
    // `reorderBlockedBySort` is recomputed each pass; announcing on each would
    // interrupt the reader mid-sentence for as long as the sort is on.
    assert.match(
      screen(),
      /useEffect\(\(\) => \{\n\s*if \(!reorderBlockedBySort\) return;\n\s*announceMessage\(t\("reorderBlockedBySort"\)\);\n\s*\}, \[reorderBlockedBySort, t\]\);/,
    );
  });

  it("keeps the visible notice too — the announcement is the second route, not a replacement", () => {
    const src = screen();
    assert.match(src, /accessibilityRole="alert"/);
    assert.match(src, /\{t\("reorderBlockedBySort"\)\}/);
  });

  it("is declared where the gate is, above the early returns that narrow the collection", () => {
    // Hooks may not sit below a conditional return, and this one reads a value
    // derived above them for exactly that reason.
    const src = screen();
    assert.ok(
      src.indexOf("const reorderBlockedBySort =") < src.indexOf("announceMessage(t(\"reorderBlockedBySort\"))"),
      "the effect must come after the value it watches",
    );
  });
});
