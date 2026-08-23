import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatBaselineProvenanceFailure,
  evaluatePrivacyBaselineShape,
} from "../lib/privacy-baseline-provenance";
import {
  policySourcePathFor,
  privacyPolicySourcePath,
  type PrivacyBodyBaseline,
} from "../lib/privacy-body-baselines";
import {
  PRIVACY_DEFAULT_LANGUAGE,
  PRIVACY_PAGE_LANGUAGES,
} from "../lib/privacy-languages";
import {
  PRIVACY_TRANSLATED_LANGUAGES,
  type PrivacyTranslationSource,
} from "../lib/privacy-translated-section";
import {
  evaluateTranslationProvenanceShape,
  formatTranslationProvenanceReport,
} from "../lib/privacy-translation-provenance";
import {
  formatUnknownProvenanceKey,
  unknownProvenanceKeyDetail,
  type ProvenanceKeySet,
} from "../lib/provenance-key-set";
import { stripComments } from "../lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

/**
 * One closed-set rule for the tables that have keys.
 *
 * The rule shipped twice in one morning, in two shape halves whose first eight
 * lines were the same eight lines. What is pinned here is the merge: that the
 * rule behaves, that the two tables still validate against DIFFERENT sets (which
 * is the reason the set is data rather than a constant the rule reaches for),
 * that both refusals come out of one formatter, and that a fourth keyed table
 * cannot quietly write a third copy.
 */

const KNOWN_CODES = PRIVACY_PAGE_LANGUAGES.map(({ code }) => code);

const SET: ProvenanceKeySet = {
  table: "FAKE_TABLE",
  outsideMeans: "no page is published for",
  listLabel: "Known codes",
  members: ["en", "de"],
};

function baseline(
  overrides: Partial<PrivacyBodyBaseline> = {},
): PrivacyBodyBaseline {
  return {
    words: 400,
    recordedOn: "2026-08-23",
    note: "measured after the retention paragraph landed",
    ...overrides,
  };
}

function entry(
  overrides: Partial<PrivacyTranslationSource> = {},
): PrivacyTranslationSource {
  return {
    sourceChecksum: "0123456789abcdef",
    translatedChecksum: "fedcba9876543210",
    checkedOn: "2026-08-23",
    note: "confirmed against the English disclosure after the retention change",
    ...overrides,
  };
}

describe("unknownProvenanceKeyDetail", () => {
  it("passes a member and refuses a stranger", () => {
    assert.equal(unknownProvenanceKeyDetail("de", SET), null);
    assert.equal(unknownProvenanceKeyDetail("de-DE", SET), "en, de");
  });

  it("hands back the members it tested, so the detail cannot name another list", () => {
    // The point of returning the detail rather than a boolean: neither caller
    // reaches into the set to build the message's list, so neither can join a
    // list other than the one membership was decided by.
    assert.equal(unknownProvenanceKeyDetail("fr", SET), SET.members.join(", "));
  });

  it("is exact rather than prefix- or case-insensitive", () => {
    // The three shapes a real table produces: a locale tag, a case slip, and a
    // missing key. Each of them looks enough like a code to be pasted in.
    for (const stranger of ["en-GB", "EN", ""]) {
      assert.notEqual(
        unknownProvenanceKeyDetail(stranger, SET),
        null,
        `"${stranger}" passed as a member of ${SET.members.join(", ")}`,
      );
    }
  });
});

describe("formatUnknownProvenanceKey", () => {
  it("names the table, the key, the file it would have described, and the set", () => {
    const message = formatUnknownProvenanceKey("fr", SET, "en, de");
    assert.match(message, /FAKE_TABLE\["fr"\]/);
    assert.match(message, /no page is published for/);
    assert.match(message, /PRIVACY\.md\.fr/);
    assert.match(message, /Known codes: en, de\./);
  });

  it("says WHY the silence would have looked like a pass", () => {
    // Without this clause the reader is told a language is unknown and goes
    // looking for the file. The failure is that the file never existed and the
    // drift half reports it as untouched.
    assert.match(
      formatUnknownProvenanceKey("fr", SET, "en, de"),
      /untouched rather than as missing/,
    );
  });

  it("does not ask the checked path helper, which would throw on this very key", () => {
    // The message exists to refuse a code `privacyPolicySourcePath` refuses;
    // asking it for the path would replace the report with the exception this
    // rule was moved out of the drift half to avoid.
    assert.throws(() => privacyPolicySourcePath("fr"));
    assert.doesNotThrow(() => formatUnknownProvenanceKey("fr", SET, "en, de"));
  });

  it("falls back to the live set when the failure carries no detail", () => {
    assert.match(
      formatUnknownProvenanceKey("fr", SET, undefined),
      /Known codes: en, de\./,
    );
  });
});

describe("the two tables that have keys", () => {
  it("validate against different sets, which is why the set is data", () => {
    // Baselines cover every page the picker offers, English included — English
    // IS a page here, and the largest baseline in the table.
    assert.deepEqual(codesOfBaseline({ en: baseline() }), []);
    // The translation table covers the five translations only: an `en` entry
    // there has recorded a checksum of PRIVACY.md against itself.
    assert.deepEqual(codesOfTranslation({ en: entry() }), ["unknown_language"]);
    assert.ok(
      KNOWN_CODES.includes(PRIVACY_DEFAULT_LANGUAGE),
      "the baselines set no longer contains the default language",
    );
    assert.ok(
      !PRIVACY_TRANSLATED_LANGUAGES.includes(PRIVACY_DEFAULT_LANGUAGE),
      "the translations set now contains the default language",
    );
  });

  it("refuse the same stranger, each naming its own table and its own set", () => {
    const fromBaselines = baselineRefusal("de-DE");
    const fromTranslations = translationRefusal("de-DE");

    assert.match(fromBaselines, /PRIVACY_BODY_BASELINES\["de-DE"\]/);
    assert.match(fromBaselines, /Known codes: /);
    assert.match(fromTranslations, /PRIVACY_TRANSLATION_SOURCES\["de-DE"\]/);
    assert.match(fromTranslations, /Translated pages: /);

    for (const code of KNOWN_CODES) {
      assert.ok(
        fromBaselines.includes(code),
        `the baselines refusal does not name the known code ${code}: ${fromBaselines}`,
      );
    }
    for (const code of PRIVACY_TRANSLATED_LANGUAGES) {
      assert.ok(
        fromTranslations.includes(code),
        `the translations refusal does not name ${code}: ${fromTranslations}`,
      );
    }
  });

  it("say it in ONE sentence shape — the merge, asserted rather than described", () => {
    // Both refusals rendered through the same formatter differ only in the three
    // phrases their sets carry. Substitute those and the strings are equal; the
    // day somebody hand-writes a third wording, this is what goes red.
    const normalised = (message: string) =>
      message
        .replace(/PRIVACY_BODY_BASELINES|PRIVACY_TRANSLATION_SOURCES/, "TABLE")
        .replace(/no (TRANSLATED )?\/privacy page is published for/, "OUTSIDE")
        .replace(/(Known codes|Translated pages): [^.]*\./, "LIST.");
    assert.equal(
      normalised(baselineRefusal("de-DE")),
      normalised(translationRefusal("de-DE")),
    );
  });

  it("neither of them still spells the refusal itself", () => {
    // Derivation working, checked at the source: an evaluator that mentions the
    // `unknown_language` code has to reach the shared rule for it. A fourth
    // keyed table's author does not have to know this rule exists — they have to
    // fail this case to avoid it.
    const offenders = [
      "lib/privacy-baseline-provenance.ts",
      "lib/privacy-translation-provenance.ts",
    ].filter((module) => {
      const source = stripComments(readRepoFile(module));
      return (
        source.includes("unknown_language") &&
        !source.includes('from "./provenance-key-set"')
      );
    });
    assert.deepEqual(
      offenders,
      [],
      `these evaluators carry the unknown-key rule without the shared one: ${offenders.join(", ")}`,
    );
    // The sweep's positive control: both modules do still raise the code, so a
    // pattern that stopped matching cannot pass as a clean tree.
    for (const module of [
      "lib/privacy-baseline-provenance.ts",
      "lib/privacy-translation-provenance.ts",
    ]) {
      assert.ok(
        stripComments(readRepoFile(module)).includes("unknown_language"),
        `${module} no longer raises unknown_language, so the sweep above matches nothing`,
      );
    }
  });
});

describe("the list the closed sets are built from", () => {
  /**
   * Every module that names one of the two constants, found rather than listed.
   *
   * `lib/privacy-page.ts` also carries an HTML renderer, a markdown pass, a CSP
   * string and a language picker. While the list lived there, every one of these
   * pulled a page renderer into its import graph to ask which codes exist — and
   * `privacy-baseline-provenance` reached the same constant through two paths,
   * which is how an import cycle gets made by somebody moving a helper.
   *
   * DERIVED, and the derivation is the interesting part. This was six module
   * paths typed out, which is a list that goes stale in the one direction a
   * sweep cannot survive: a seventh module reaching for the renderer is a module
   * the sweep does not look at, so the guard reports clean about a tree it did
   * not read. It is also the fourth hand-written module list in this family.
   *
   * The population is "modules that want the language list", and the honest way
   * to ask that is what a module NAMES, not what it imports — deriving it from
   * the import would make the positive control below vacuous, since every member
   * would import the leaf by construction. Naming a constant is independent of
   * where it came from, which is exactly the property the sweep is about.
   *
   * `scripts/` is walked too, and picks up a seventh asker the hand-written list
   * never had: `build-spa-fallback.ts`, which reads both constants to write the
   * per-language pages and is under the same rule for the same reason.
   */
  const CONSTANTS = ["PRIVACY_PAGE_LANGUAGES", "PRIVACY_DEFAULT_LANGUAGE"];

  const ASKERS = sourceFiles("lib", "scripts").filter((file) => {
    // The two modules that are not askers: the leaf DECLARES the constants, and
    // the renderer is the module they were moved out of — that it reads the leaf
    // is asserted in `__tests__/privacy-languages.test.ts`, where the rest of
    // the leaf's own shape cases live.
    if (file === "lib/privacy-languages.ts" || file === "lib/privacy-page.ts") {
      return false;
    }
    const source = stripComments(readRepoFile(file));
    return CONSTANTS.some((constant) => source.includes(constant));
  });

  it("finds the askers, rather than trusting a list of them", () => {
    // The floor is what stops a walk that matched nothing — a renamed directory,
    // a `stripComments` that ate the file — reading as a clean sweep. Six is the
    // count the hand-written list had, so the walk cannot pass while covering
    // LESS than the list it replaced.
    assert.ok(
      ASKERS.length >= 6,
      `only ${String(ASKERS.length)} module(s) name the language constants — the sweep below would prove nothing: ${ASKERS.join(", ")}`,
    );
    // And the seventh the list did not have, named so that a reader can see the
    // derivation bought something rather than take it on trust.
    assert.ok(
      ASKERS.includes("scripts/build-spa-fallback.ts"),
      "the walk no longer reaches scripts/, which reads both constants to write the per-language pages",
    );
  });

  /**
   * What a module takes FROM the page renderer, or null if it does not import
   * it at all.
   *
   * The rule is not "does not import `privacy-page`" — that was the shape the
   * hand-written list could get away with, because it happened to contain no
   * module that legitimately renders a page. The walk found one immediately:
   * `scripts/build-spa-fallback.ts` imports `renderPrivacyPage` because writing
   * the six pages is its whole job, and a sweep that called that an offence
   * would be a sweep somebody deletes. What is banned is taking the LANGUAGE
   * LIST from the renderer, which is a different clause of the same import.
   *
   * Both spellings, matched by suffix: `./privacy-page` from `lib/`,
   * `../lib/privacy-page` from `scripts/`.
   */
  function importedFromPageRenderer(module: string): string | null {
    const match = /import\s*(\{[^}]*\})\s*from\s*"\.[./a-z-]*privacy-page"/.exec(
      stripComments(readRepoFile(module)),
    );
    return match?.[1] ?? null;
  }

  it("takes the language list from none of them through the page renderer", () => {
    const offenders = ASKERS.filter((module) => {
      const clause = importedFromPageRenderer(module);
      return (
        clause !== null &&
        CONSTANTS.some((constant) => clause.includes(constant))
      );
    });
    assert.deepEqual(
      offenders,
      [],
      `these modules take a language constant out of the /privacy page renderer rather than the leaf: ${offenders.join(", ")}`,
    );
    // Today the rule above cannot fire, because the constants were MOVED and
    // `privacy-page` exports neither — an import of one from there does not
    // compile. That is the guarantee; this is the backstop for the day somebody
    // adds a convenience re-export, at which point the compiler stops caring and
    // this is the only thing left that does.
    assert.ok(
      !/export\s*\{[^}]*PRIVACY_(PAGE_LANGUAGES|DEFAULT_LANGUAGE)/.test(
        stripComments(readRepoFile("lib/privacy-page.ts")),
      ),
      "lib/privacy-page.ts re-exports a language constant — the split is a redirect again, and the sweep above is now the only thing stopping the old import graph coming back",
    );
    // The positive control, and it is not vacuous because the list above was
    // built from what the modules NAME: a module that names a constant and
    // imports it from nowhere is a module that got it from somewhere else.
    const notAsking = ASKERS.filter(
      (module) =>
        !/from "\.[./a-z-]*privacy-languages"/.test(
          stripComments(readRepoFile(module)),
        ),
    );
    assert.deepEqual(
      notAsking,
      [],
      `these modules name a language constant without importing the leaf: ${notAsking.join(", ")}`,
    );
  });

  // The leaf's other two shape cases — that it has no imports, and that the
  // page renderer reads the same list — moved to
  // `__tests__/privacy-languages.test.ts`. Neither was about the provenance
  // family, and a reader deleting that module would not think to look in a
  // key-set suite for what breaks. The sweep above stayed here, where the
  // askers are.
});

describe("the path a refused key would have named", () => {
  it("is the same template privacyPolicySourcePath answers with", () => {
    for (const code of KNOWN_CODES) {
      assert.equal(policySourcePathFor(code), privacyPolicySourcePath(code));
    }
  });

  it("answers for a code no page exists for, which is all it is for", () => {
    assert.equal(policySourcePathFor("de-DE"), "PRIVACY.md.de-DE");
    assert.throws(() => privacyPolicySourcePath("de-DE"));
  });

  it("reports an `en` translation entry as the file measured against itself", () => {
    // Not `PRIVACY.md.en` — the interesting thing about that entry is precisely
    // that it fingerprints the English source as if it were a translation of it.
    assert.match(translationRefusal("en"), /describes PRIVACY\.md,/);
  });
});

function codesOfBaseline(
  table: Readonly<Record<string, PrivacyBodyBaseline>>,
): readonly string[] {
  return evaluatePrivacyBaselineShape(table).map((failure) => failure.code);
}

function codesOfTranslation(
  table: Readonly<Record<string, PrivacyTranslationSource>>,
): readonly string[] {
  return evaluateTranslationProvenanceShape(table).map(
    (failure) => failure.code,
  );
}

function baselineRefusal(code: string): string {
  const failures = evaluatePrivacyBaselineShape({ [code]: baseline() });
  const failure = failures.find((each) => each.code === "unknown_language");
  assert.ok(failure, `"${code}" was not refused by the baselines table`);
  return formatBaselineProvenanceFailure("guard", failure);
}

function translationRefusal(code: string): string {
  return formatTranslationProvenanceReport("guard", {
    ok: false,
    failures: evaluateTranslationProvenanceShape({ [code]: entry() }).filter(
      (failure) => failure.code === "unknown_language",
    ),
    checked: 1,
    comparedAgainst: null,
  });
}
