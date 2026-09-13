import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import {
  I18N_LOCALE_SOURCES,
  I18N_PROVIDER_SOURCE,
  I18N_SOURCE_FILES,
  I18N_TYPES_SOURCE,
} from "../lib/i18n-source-files";
import { findObjectLiteral, localeKeys } from "../lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";
import { locales } from "./helpers/i18n-locales";
import { readRepoFile, repoPath } from "./helpers/repo-file";

/**
 * The locale split's own invariants.
 *
 * The six maps were 3696 of `lib/i18n-context.tsx`'s 3929 lines and 314 KiB of
 * the web bundle — the largest single thing every visitor downloads, because
 * Metro escapes the Cyrillic and the Polish diacritics as `\uXXXX` and six
 * locales cost six bytes a letter. They are modules now so that four of them
 * can eventually be fetched on demand; NOTHING is lazy yet, and the cases here
 * are about the move rather than about the copy, which a hundred other suites
 * already ask after.
 */

const PROVIDER = readRepoFile(I18N_PROVIDER_SOURCE);

/**
 * The languages the picker offers, read from the picker — never written out.
 *
 * `i18n-locale-list-restated.test.ts` holds that rule for every suite: a
 * seventh language must not leave a case silently asking about six, and a file
 * list is exactly the place that rot would hide.
 */
const CODES = locales(readI18nSource());

/** The same set, as the file basenames this split turned them into. */
const CODES_FROM_PATHS = I18N_LOCALE_SOURCES.map(
  (rel) => rel.split("/").pop()?.replace(".ts", "") ?? "",
);

describe("lib/i18n-source-files.ts names files that exist", () => {
  it("lists the provider, the types and the six maps", () => {
    assert.deepEqual(I18N_SOURCE_FILES, [
      I18N_PROVIDER_SOURCE,
      I18N_TYPES_SOURCE,
      ...I18N_LOCALE_SOURCES,
    ]);
    // One module per language the picker offers, derived from the picker: a
    // seventh language with no module is copy nothing measures.
    assert.deepEqual([...CODES_FROM_PATHS].sort(), [...CODES].sort());
  });

  it("every path resolves to a file in this tree", () => {
    // The whole point of one list: a seventh language that lands in the tree
    // and not in here is copy nothing measures, which reads as copy that costs
    // nothing.
    for (const rel of I18N_SOURCE_FILES) {
      assert.ok(existsSync(repoPath(rel)), `${rel} does not exist`);
    }
  });

  it("names no file twice", () => {
    assert.equal(new Set(I18N_SOURCE_FILES).size, I18N_SOURCE_FILES.length);
  });

  it("is these eight files, spelled out", () => {
    // Spelled rather than derived, in one case, because a path that appears
    // nowhere in any suite is a module nobody has decided about —
    // `suite-named-modules.test.ts` sweeps for exactly that, and the other
    // cases here reach these files through the list rather than by name.
    assert.deepEqual(I18N_SOURCE_FILES, [
      "lib/i18n-context.tsx",
      "lib/i18n/types.ts",
      "lib/i18n/en.ts",
      "lib/i18n/ru.ts",
      "lib/i18n/be.ts",
      "lib/i18n/pl.ts",
      "lib/i18n/de.ts",
      "lib/i18n/es.ts",
    ]);
  });
});

describe("each locale is a module of its own", () => {
  const codes = CODES_FROM_PATHS;

  it("declares and exports the map the file is named after", () => {
    for (const [i, rel] of I18N_LOCALE_SOURCES.entries()) {
      const src = readRepoFile(rel);
      assert.match(
        src,
        new RegExp(`^export const ${codes[i]}\\b`, "m"),
        `${rel} must export a map called ${codes[i]}`,
      );
    }
  });

  it("spreads en, so an untranslated key renders English rather than nothing", () => {
    for (const [i, rel] of I18N_LOCALE_SOURCES.entries()) {
      if (codes[i] === "en") continue;
      const literal = findObjectLiteral(readRepoFile(rel), codes[i]);
      assert.ok(literal, `${rel}: no ${codes[i]} map found`);
      assert.deepEqual(literal.spreads, ["en"]);
    }
  });

  it("imports no provider, so a dictionary stays a dictionary", () => {
    // The reason the maps are not simply re-exported from the context module:
    // a locale that imported it would pull React, AsyncStorage and the
    // analytics client into a file whose entire content is strings — and into
    // the chunk it is eventually meant to be fetched in.
    for (const rel of I18N_LOCALE_SOURCES) {
      // The IMPORTS, not the prose: every one of these files explains in its
      // header where it came from, which is the sentence a substring sweep
      // would forbid it from writing.
      const specifiers = [...readRepoFile(rel).matchAll(/from "([^"]+)";/g)].map((m) => m[1]);
      for (const specifier of specifiers) {
        assert.ok(
          !/i18n-context|^react$|async-storage/.test(specifier),
          `${rel} imports ${specifier}, which makes a dictionary a component`,
        );
      }
    }
  });

  it("keeps the key set in en, where TranslationKey is derived from it", () => {
    const en = readRepoFile(I18N_LOCALE_SOURCES[0]);
    assert.match(en, /export type TranslationKey = keyof typeof en;/);
    assert.match(en, /export type TranslationMap = Record<TranslationKey, TranslationValue>;/);
    assert.ok(
      !PROVIDER.includes("export type TranslationKey = keyof"),
      "the key type is declared once, beside the map it is derived from",
    );
  });
});

describe("the provider still answers for the names the app imports", () => {
  it("re-exports AppLanguage and TranslationKey from @/lib/i18n-context", () => {
    // A hundred modules import these from here. The maps moving is not a
    // reason to touch a hundred import lines.
    assert.match(PROVIDER, /export type \{ AppLanguage \} from "@\/lib\/i18n\/types";/);
    assert.match(PROVIDER, /export type \{ TranslationKey \} from "@\/lib\/i18n\/en";/);
  });

  it("still builds `translations` from all six maps", () => {
    const literal = findObjectLiteral(PROVIDER, "translations");
    assert.ok(literal, "the translations map is gone from the provider");
    assert.deepEqual(
      [...literal.keys].sort(),
      I18N_LOCALE_SOURCES.map((rel) => rel.split("/").pop()?.replace(".ts", "")).sort(),
    );
  });

  it("carries none of the copy itself any more", () => {
    // 3929 lines to a few hundred. A stray map left behind would be copy that
    // ships whatever the split does later.
    for (const code of CODES) {
      assert.equal(
        findObjectLiteral(PROVIDER, code),
        null,
        `the ${code} map is still declared in the provider`,
      );
    }
  });
});

describe("what the source readers see", () => {
  it("finds every locale map in the concatenated source", () => {
    // The suites ask "does every locale declare this key" of one string; that
    // string is seven files joined now, and `lib/i18n-source.ts` reads
    // declarations rather than offsets, so it is the same subject.
    const joined = readI18nSource();
    for (const rel of I18N_LOCALE_SOURCES) {
      const code = rel.split("/").pop()?.replace(".ts", "") ?? "";
      assert.ok(localeKeys(joined, code).size > 100, `${code} reads as empty`);
    }
  });

  it("finds the AppLanguage union, which lives with the types now", () => {
    const union = readI18nSource().match(/export type AppLanguage\s*=\s*([^;]+);/);
    assert.ok(union, "the union must stay readable from the i18n source");
    for (const code of CODES) {
      assert.ok(union[1].includes(`"${code}"`), `the union must declare ${code}`);
    }
  });

  it("the copy measure reads all seven files, not just the provider", () => {
    // The failure this prevents is a silent one: the drift line would report
    // the copy as having shrunk by 300 KiB in a commit that only moved it.
    const gate = readRepoFile("scripts/check-bundle-size.ts");
    assert.match(gate, /I18N_SOURCE_FILES/);
    assert.ok(
      !gate.includes('"lib/i18n-context.tsx"'),
      "the gate must not spell one file's path again",
    );
  });
});
