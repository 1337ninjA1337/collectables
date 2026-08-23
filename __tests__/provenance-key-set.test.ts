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
import { PRIVACY_DEFAULT_LANGUAGE, PRIVACY_PAGE_LANGUAGES } from "../lib/privacy-page";
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
