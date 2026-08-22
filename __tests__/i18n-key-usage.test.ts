import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  collectStringLiterals,
  indexI18nKeyUsage,
  unreadI18nKeys,
  type ScannedSource,
} from "@/lib/i18n-key-usage";
import { localeKeys, TRANSLATION_BASE_LANGUAGE } from "@/lib/i18n-source";

import { I18N_SOURCE_REL, readI18nSource } from "./helpers/i18n-source-file";
import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * The reverse index every i18n question about the SOURCE tree is asked of.
 *
 * Two halves, and they fail differently. The literal rule — what counts as a
 * read — is the half `check-orphan-i18n-keys` shipped and the half a false
 * positive comes from; its cases moved here with it, unchanged, because the
 * rule did not change when it moved. The INDEX is the new half: file → keys,
 * key → files, and the two agreeing with each other.
 *
 * The last block is the one that justifies the extraction. A per-screen
 * translation rule is the reason this module exists, and a reader that turned
 * out to credit the real `app/` tree with nothing would be an index nobody
 * could build a rule on. So it runs over the actual source tree and states
 * what it finds — not an assertion about any one screen, which would be a
 * chore, but that the index is populated, agrees with itself, and stays inside
 * the base map.
 */

/** A translations source in miniature, with the shape the parser needs. */
const TRANSLATIONS_KEYS = [
  "greeting",
  "sortNameAsc",
  "conditionNew",
  "orphan",
] as const;

const sources = (...entries: readonly string[]): ScannedSource[] =>
  entries.map((source, index) => ({ file: `app/file-${index}.tsx`, source }));

describe("collecting the literals that sit where a key is written", () => {
  it("finds a literal in each of the five key positions, in either quote", () => {
    // The alternation IS the rule, so every branch of it gets a reading.
    assert.ok(collectStringLiterals(`t("greeting");`).has("greeting"));
    assert.ok(collectStringLiterals(`pick(t, 'greeting');`).has("greeting"));
    assert.ok(collectStringLiterals(`const m = { labelKey: "greeting" };`).has("greeting"));
    assert.ok(collectStringLiterals('t(`x` as "greeting");').has("greeting"));
    assert.ok(collectStringLiterals(`type K =\n  | "greeting";`).has("greeting"));
    assert.ok(collectStringLiterals(`const all = ["other", "greeting"];`).has("greeting"));
  });

  it("does NOT count a literal used as a plain value", () => {
    // The distinction that found the 37th orphan. `you` is declared in all six
    // locales, rendered by nothing, and its only mention in the tree is a
    // default display name — a fallback VALUE, not a key.
    const found = collectStringLiterals(
      `const baseName = user.email?.split("@")[0] ?? "you";`,
    );
    assert.ok(!found.has("you"));
  });

  it("does not count an assignment or a comparison either", () => {
    assert.ok(!collectStringLiterals(`const a = "greeting";`).has("greeting"));
    assert.ok(!collectStringLiterals(`if (x === "greeting") {}`).has("greeting"));
    assert.ok(!collectStringLiterals(`return "greeting";`).has("greeting"));
  });

  it("ignores anything that is not identifier-shaped", () => {
    // Restricted on purpose: matching arbitrary string bodies would pull in
    // every sentence in the tree for hits that can never be keys.
    const found = collectStringLiterals(`t("hello there"); t("with-dash");`);
    assert.equal(found.size, 0);
  });

  it("strips comments first, so prose naming a key does not keep it alive", () => {
    // Without this the guard's own doc comment would resurrect nine of the
    // keys it exists to have removed — and the comment defining the rule names
    // four more.
    const found = collectStringLiterals(`// we removed t("orphan") last week\nconst a = 1;`);
    assert.ok(!found.has("orphan"));
  });

  it("does not treat an identifier as a literal", () => {
    // The distinction that found the 36th orphan: `(profileId: string)` is a
    // parameter, not a mention of the key `profileId`.
    const found = collectStringLiterals(`function f(profileId: string) { return profileId; }`);
    assert.ok(!found.has("profileId"));
  });
});

describe("indexing which file reads which key", () => {
  it("answers what one file reads, which is the question a screen rule asks", () => {
    const usage = indexI18nKeyUsage(
      TRANSLATIONS_KEYS,
      sources(`t("greeting"); t("conditionNew");`),
    );
    assert.deepEqual(usage.byFile.get("app/file-0.tsx"), [
      "greeting",
      "conditionNew",
    ]);
  });

  it("answers which files read one key, in scan order", () => {
    const usage = indexI18nKeyUsage(
      TRANSLATIONS_KEYS,
      sources(`t("greeting");`, `const nothing = 1;`, `pick(t, "greeting");`),
    );
    assert.deepEqual(usage.byKey.get("greeting"), [
      "app/file-0.tsx",
      "app/file-2.tsx",
    ]);
  });

  it("orders a file's keys by the base map, not by where they appear in it", () => {
    // The same choice the orphan report makes, and for the same reason: keys
    // belonging to one feature are adjacent in the map, so a family reads as a
    // run. Source order would be the order a screen happens to render in,
    // which nothing is being compared against.
    const usage = indexI18nKeyUsage(
      TRANSLATIONS_KEYS,
      sources(`t("orphan"); t("conditionNew"); t("greeting");`),
    );
    assert.deepEqual(usage.byFile.get("app/file-0.tsx"), [
      "greeting",
      "conditionNew",
      "orphan",
    ]);
  });

  it("gives a file that reads nothing an entry, not an absence", () => {
    // "This screen renders no translated text" and "this screen was not
    // scanned" are different answers, and a sparse map cannot tell them apart
    // — which would let a per-screen rule read an unwalked directory as a
    // screen with nothing left to translate.
    const usage = indexI18nKeyUsage(TRANSLATIONS_KEYS, sources(`const a = 1;`));
    assert.deepEqual(usage.byFile.get("app/file-0.tsx"), []);
    assert.ok(usage.byFile.has("app/file-0.tsx"));
    assert.ok(!usage.byFile.has("app/never-scanned.tsx"));
  });

  it("gives an unread key an empty list rather than leaving it out", () => {
    const usage = indexI18nKeyUsage(TRANSLATIONS_KEYS, sources(`t("greeting");`));
    assert.deepEqual(usage.byKey.get("orphan"), []);
    for (const key of TRANSLATIONS_KEYS) assert.ok(usage.byKey.has(key));
  });

  it("drops a literal that is not a key, however well-placed", () => {
    // The index answers "which of THESE keys does the file read", so a
    // key-shaped literal that no map declares is not a finding here. The
    // unfiltered set is `collectStringLiterals`, and one caller wants it.
    const usage = indexI18nKeyUsage(
      TRANSLATIONS_KEYS,
      sources(`t("greeting"); useRouter({ pathname: "collection" });`),
    );
    assert.deepEqual(usage.byFile.get("app/file-0.tsx"), ["greeting"]);
    assert.ok(!usage.byKey.has("collection"));
  });

  it("counts a key read twice in one file once", () => {
    const usage = indexI18nKeyUsage(
      TRANSLATIONS_KEYS,
      sources(`t("greeting"); t("greeting");`),
    );
    assert.deepEqual(usage.byFile.get("app/file-0.tsx"), ["greeting"]);
    assert.deepEqual(usage.byKey.get("greeting"), ["app/file-0.tsx"]);
  });

  it("agrees with itself in both directions", () => {
    // The property that makes the two maps one fact rather than two: a file in
    // a key's list reads that key, and a key in a file's list lists that file.
    // Cheap to state, and the thing that would break first if the loop ever
    // grew a branch that wrote one map and not the other.
    const usage = indexI18nKeyUsage(
      TRANSLATIONS_KEYS,
      sources(
        `t("greeting"); t("orphan");`,
        `const m = { labelKey: "sortNameAsc" };`,
        `const nothing = 1;`,
      ),
    );
    for (const [file, keys] of usage.byFile) {
      for (const key of keys) {
        assert.ok(usage.byKey.get(key)?.includes(file), `${file} reads ${key}`);
      }
    }
    for (const [key, files] of usage.byKey) {
      for (const file of files) {
        assert.ok(usage.byFile.get(file)?.includes(key), `${key} read by ${file}`);
      }
    }
  });

  it("reports the keys nothing read, in base-map order", () => {
    const usage = indexI18nKeyUsage(
      TRANSLATIONS_KEYS,
      sources(`t("conditionNew");`),
    );
    assert.deepEqual(unreadI18nKeys(usage), [
      "greeting",
      "sortNameAsc",
      "orphan",
    ]);
  });

  it("says every key is unread when nothing was scanned at all", () => {
    // Not a curiosity: an empty source list is what a broken walk hands over,
    // and this is the shape the orphan guard would report as 502 dead keys
    // rather than as a clean tree. Stated here so the index's answer to a
    // vacuous input is on the record and not inferred from the guard's floor.
    const usage = indexI18nKeyUsage(TRANSLATIONS_KEYS, []);
    assert.deepEqual(unreadI18nKeys(usage), [...TRANSLATIONS_KEYS]);
  });

  it("has nothing to say when no keys are asked about", () => {
    // The other vacuous input, and the reason `findOrphanI18nKeys` throws on a
    // missing base map instead of asking the index: no keys in means no
    // orphans out, which is a green run and not a finding.
    const usage = indexI18nKeyUsage([], sources(`t("greeting");`));
    assert.deepEqual(unreadI18nKeys(usage), []);
    assert.deepEqual(usage.byFile.get("app/file-0.tsx"), []);
  });
});

describe("the index over the real source tree", () => {
  const base = localeKeys(readI18nSource(), TRANSLATION_BASE_LANGUAGE);
  const usage = indexI18nKeyUsage(
    [...base],
    // The guard's walk, exclusion included: `lib/i18n-context.tsx` is left out
    // because it is where every key is declared, and a scan that read its own
    // subject would answer a different question from the one the guard asks.
    sourceFiles()
      .filter((file) => file !== I18N_SOURCE_REL)
      .map((file) => ({ file, source: sourceCode(file) })),
  );

  it("credits the screens with reading keys", () => {
    // The claim the extraction is FOR: a per-screen rule needs the index to be
    // populated over `app/`, and an index that answered "nothing" everywhere
    // would pass every case above and be useless. Asserted as a floor rather
    // than a count, because the exact number is a chore — what matters is that
    // most screens read something and that the tree's keys are not all
    // concentrated in one file.
    const screens = [...usage.byFile].filter(([file]) => file.startsWith("app/"));
    const reading = screens.filter(([, read]) => read.length > 0);
    assert.ok(screens.length > 10, `walked ${screens.length} screens`);
    assert.ok(
      reading.length > screens.length / 2,
      `${reading.length} of ${screens.length} screens read a translation key`,
    );
  });

  it("names only keys the base map declares", () => {
    for (const [, read] of usage.byFile) {
      for (const key of read) {
        assert.ok(base.has(key), `${key} is not a base key`);
      }
    }
  });

  it("reports no unread key, which is what the guard exits 0 for", () => {
    // The same fact `npm run lint:orphan-i18n` establishes, reached from the
    // index rather than from the CLI. Not a duplicate of the guard: it runs
    // under `npm test`, where the guard runs under `lint:all`, and the two
    // disagreeing would mean the projection and the walk had parted — which is
    // the risk this extraction introduced and the reason the case is here.
    assert.deepEqual(unreadI18nKeys(usage), []);
  });
});
