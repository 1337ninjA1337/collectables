/**
 * The tab change that used to happen in silence.
 *
 * On native the pager's header is a `<Text>` and a row of dots and there are no
 * tab BUTTONS at all — the swipe is the only way to change tab — so a commit
 * told a screen-reader user nothing: no role, no selected state, no sentence.
 * On web the same component renders `<Pressable>`s carrying
 * `accessibilityState={{ selected }}`, which the platform announces on press,
 * which is why the sentence belongs to the gesture rather than to the commit.
 *
 * The mechanism (`lib/announce.ts`, a platform pair) is not interesting. The
 * decisions are: WHAT is said, when to stay quiet, and which of the two routes
 * into a tab change earns a sentence — the third being the one a version built
 * inside `commitTo` would have got wrong by speaking twice on web.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { announcedPosition } from "@/lib/drag-reorder";
import { importedModules } from "@/lib/import-specifiers";
import { tabChangeSentence } from "@/lib/tab-sentence";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, assertValueInEveryLocale } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/** A translator that renders the key and its params, so a case can read both. */
const t = (key: string, params?: Record<string, string | number>): string =>
  `${key}:${params?.label ?? ""}:${params?.position ?? "?"}/${params?.total ?? "?"}`;

describe("what the swipe says", () => {
  it("names the tab and its place in the row", () => {
    assert.equal(tabChangeSentence(t, "Wishlist", 1, 3), "tabChanged:Wishlist:2/3");
  });

  it("reuses the reorder rule for the position rather than deriving its own", () => {
    // "Position N of M, or nothing" is one rule with two callers now. A second
    // derivation would be a second set of edge cases to get right.
    for (const [index, total] of [[0, 3], [2, 3]] as const) {
      const at = announcedPosition(index, total);
      assert.ok(at);
      assert.equal(tabChangeSentence(t, "Tab", index, total), `tabChanged:Tab:${at.position}/${at.total}`);
    }
  });
});

describe("when it stays quiet", () => {
  it("says nothing for a key that is not in the tab list", () => {
    // The pager resolves the target with findIndex, which answers -1 — the
    // case that would otherwise be read aloud as "position 0 of 3".
    assert.equal(tabChangeSentence(t, "Wishlist", -1, 3), null);
  });

  it("says nothing when the position is not trustworthy", () => {
    assert.equal(tabChangeSentence(t, "Wishlist", undefined, 3), null);
    assert.equal(tabChangeSentence(t, "Wishlist", 3, 3), null);
    assert.equal(tabChangeSentence(t, "Wishlist", 0, 0), null);
  });

  it("says nothing for a label that names nothing", () => {
    // ", tab 2 of 3" is the alternative, which is a position attached to no
    // subject — and a listener cannot glance at the header to supply it.
    assert.equal(tabChangeSentence(t, "", 1, 3), null);
    assert.equal(tabChangeSentence(t, "   ", 1, 3), null);
  });

  it("trims a padded label rather than reading the padding as a name", () => {
    assert.equal(tabChangeSentence(t, "  Wishlist \n", 1, 3), "tabChanged:Wishlist:2/3");
  });
});

describe("the helper's shape", () => {
  const src = () => readRepoFile("lib/tab-announcement.ts");

  it("takes `t` as a parameter rather than calling the hook", () => {
    // It runs inside a PanResponder handler, where `useI18n()` would be a
    // rules-of-hooks violation, and inside this suite, where there is no React.
    const code = src();
    assert.doesNotMatch(code, /useI18n\(/);
    assert.match(code, /export function announceTabChange\(\s*\n\s*t: TabTranslate,/);
  });

  it("accepts only the key it has translations for", () => {
    assert.match(readRepoFile("lib/tab-sentence.ts"), /export type TabAnnouncement = "tabChanged";/);
  });

  it("keeps the decision out of the module that pulls react-native", () => {
    // `@/lib/announce` is a platform pair, so anything importing it is
    // unreachable from a node suite. The cases above run because the sentence
    // lives next door — the same split drag-reorder / reorder-announcement has.
    // The IMPORTS, not the text: this module's own header explains the split
    // by naming the module it must not pull, which a text scan would read as
    // the offence it is describing.
    assert.ok(
      !importedModules(readRepoFile("lib/tab-sentence.ts")).some((m) => m.endsWith("/announce")),
      "lib/tab-sentence.ts must stay node-runnable",
    );
    assert.match(src(), /const sentence = tabChangeSentence\(t, label, index, total\);\n\s*if \(sentence\) announceMessage\(sentence\);/);
  });
});

describe("the pager says it, once, on the route that has no other feedback", () => {
  const src = () => readRepoFile("components/swipe-tabs.tsx");

  it("speaks on both swipe directions and nowhere else", () => {
    const code = src();
    assert.match(code, /commitTo\(t\[idx \+ 1\]\.key, "next", true\)/);
    assert.match(code, /commitTo\(t\[idx - 1\]\.key, "prev", true\)/);
    // jumpToKey is the web press path: the Pressable already carries
    // accessibilityState={{ selected }}, so a sentence here would be the
    // second time the platform said the same thing.
    assert.match(code, /function jumpToKey[\s\S]*?commitTo\(targetKey, "next"\);/);
    assert.match(code, /function jumpToKey[\s\S]*?commitTo\(targetKey, "prev"\);/);
  });

  it("defaults to silent, so a caller added later has to opt in", () => {
    assert.match(src(), /function commitTo\(targetKey: string, direction: "next" \| "prev", spoken = false\)/);
  });

  it("speaks after the change, not before it", () => {
    // The `!finished` branch returns without changing anything. A sentence
    // spoken for a gesture the pager then abandoned is one the listener has no
    // way to check.
    const code = src();
    const announced = code.indexOf("if (spoken) speakTab(targetKey);\n    });");
    const changed = code.indexOf("onChangeRef.current(targetKey);\n      // After the change");
    assert.ok(changed > 0 && announced > changed, "the announcement must follow onChange in the completion callback");
  });

  it("reads the translator through a ref, like everything else the PanResponder touches", () => {
    // The responder is built inside `useRef(...).current` and never rebuilt, so
    // a captured `translate` is the language the app was STARTED in — and it
    // would keep speaking it after the user changed languages.
    const code = src();
    assert.match(code, /const translateRef = useLatestRef\(translate\);/);
    assert.match(code, /announceTabChange\(translateRef\.current,/);
  });
});

describe("the copy", () => {
  const source = () => readI18nSource();

  it("is declared in every locale, not inherited from English", () => {
    assertDeclaredInEveryLocale(source(), "tabChanged");
  });

  it("carries the label and both numbers in all six", () => {
    assertValueInEveryLocale(
      source(),
      "tabChanged",
      /params\?\.label[\s\S]*params\?\.position[\s\S]*params\?\.total/,
      "tabChanged must name the tab and its place",
    );
  });
});
