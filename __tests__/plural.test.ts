import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { plural, slavicPlural } from "@/lib/plural";

import { measuredFloor } from "./helpers/coverage-floor";
import { moduleDoc } from "./helpers/module-doc";
import { assertOnlyTheseMatch } from "./helpers/offence-sweep";
import { readRepoFile } from "./helpers/repo-file";
import { sourceCode, sourceFiles } from "./helpers/source-files";
import { suiteCode, suiteFiles } from "./helpers/suite-files";

/**
 * Both branches, exercised at the numbers that distinguish them.
 *
 * A three-form rule tested at 1, 2 and 5 passes with the rule spelled
 * backwards: every Slavic language agrees on those three, and what separates a
 * correct implementation from a plausible one is the teens. 11 takes the
 * "many" form despite ending in 1, and 111 takes the singular despite ending
 * in 11 — the `% 100` term is the whole content of the rule, and both halves
 * of it are checked here rather than assumed.
 *
 * The two-form rule has one interesting number and it is zero, which takes the
 * PLURAL in all three of the languages that use it ("0 items", not "0 item").
 * Written as `=== 1` rather than `< 2` for exactly that, and checked below.
 */

describe("plural", () => {
  const item = (n: unknown) => plural(n, "item", "items");

  it("takes the singular for exactly one, and nothing else", () => {
    assert.equal(item(1), "item");
    for (const n of [0, 2, 3, 11, 21, 100]) {
      assert.equal(item(n), "items", `${n} should take the plural`);
    }
  });

  it("puts zero on the plural, which is the whole reason it is not `< 2`", () => {
    // "0 items" in English, German and Spanish alike. A rule written as
    // "fewer than two takes the singular" is green at 1 and wrong at 0, and 0
    // is the number an empty collection shows.
    assert.equal(item(0), "items");
    assert.equal(plural(0, "Objekt", "Objekte"), "Objekte");
    assert.equal(plural(0, "objeto", "objetos"), "objetos");
  });

  it("reads a numeric string and falls to the plural for anything else", () => {
    // `TranslationParams` values are `string | number`, and a missing param
    // arrives as `undefined`. "some unknown quantity of items" reads
    // correctly; the singular would assert there is exactly one.
    assert.equal(item("1"), "item");
    for (const bad of [undefined, null, "", "abc", NaN, {}]) {
      assert.equal(item(bad), "items", `${String(bad)} should fall to the plural`);
    }
  });

  it("ignores the sign and the fraction rather than inventing a form", () => {
    assert.equal(item(-1), "item");
    assert.equal(item(1.7), "item");
    assert.equal(item(2.1), "items");
  });
});

const ITEM = ["предмет", "предмета", "предметов"] as const;
const pick = (n: unknown) => slavicPlural(n, ...ITEM);

describe("slavicPlural", () => {
  it("takes the singular for numbers ending in one", () => {
    for (const n of [1, 21, 31, 101, 1001]) {
      assert.equal(pick(n), "предмет", `${n} should take the singular`);
    }
  });

  it("takes the few form for numbers ending in two, three and four", () => {
    for (const n of [2, 3, 4, 22, 33, 44, 104]) {
      assert.equal(pick(n), "предмета", `${n} should take the few form`);
    }
  });

  it("takes the many form for five through nine, and for zero", () => {
    for (const n of [0, 5, 6, 9, 25, 100, 1000]) {
      assert.equal(pick(n), "предметов", `${n} should take the many form`);
    }
  });

  it("puts the whole teens range on the many form", () => {
    // 11 ends in 1 and 12–14 end in 2–4, so a rule written with `% 10` alone
    // gets all four wrong and still passes every case above.
    for (const n of [11, 12, 13, 14, 111, 112, 113, 114, 211, 1013]) {
      assert.equal(pick(n), "предметов", `${n} is in a teens range and takes the many form`);
    }
  });

  it("comes back out of the teens at 21 and 121", () => {
    // The other side of the same boundary: a rule that special-cased
    // `n >= 11 && n <= 14` on the raw number instead of on `% 100` would be
    // green above and wrong here.
    assert.equal(pick(21), "предмет");
    assert.equal(pick(22), "предмета");
    assert.equal(pick(121), "предмет");
    assert.equal(pick(122), "предмета");
  });

  it("holds for Polish, whose three forms are different words", () => {
    // The branch is shared and the FORMS are not: Polish takes nominative
    // singular, nominative plural and genitive plural. This is the case that
    // says the module is about the rule rather than about Russian.
    const polish = (n: number) => slavicPlural(n, "przedmiot", "przedmioty", "przedmiotów");
    assert.equal(polish(1), "przedmiot");
    assert.equal(polish(3), "przedmioty");
    assert.equal(polish(5), "przedmiotów");
    assert.equal(polish(12), "przedmiotów");
    assert.equal(polish(22), "przedmioty");
  });

  it("falls to the many form for anything that is not a number", () => {
    // `TranslationParams` values are `string | number`, so a caller can hand
    // this a string, and a missing param arrives as `undefined`. "some unknown
    // quantity of предметов" reads correctly; "предмет" would assert one.
    for (const bad of [undefined, null, "", "abc", NaN, {}]) {
      assert.equal(pick(bad), "предметов", `${String(bad)} should fall to the many form`);
    }
  });

  it("reads a numeric string, because a caller may well pass one", () => {
    assert.equal(pick("1"), "предмет");
    assert.equal(pick("3"), "предмета");
    assert.equal(pick("11"), "предметов");
  });

  it("ignores the sign and the fraction rather than inventing a form", () => {
    // Neither shape occurs in this app — everything counted is a row — and
    // both have a defined answer here rather than an accidental one. A
    // fraction genuinely takes a fourth form in Polish; truncating to the
    // integer part is the documented approximation, not an oversight.
    assert.equal(pick(-1), "предмет");
    assert.equal(pick(-5), "предметов");
    assert.equal(pick(1.7), "предмет");
    assert.equal(pick(5.2), "предметов");
  });

  it("does not return a form it was not given", () => {
    // A guard against a future branch returning a hard-coded string: the
    // answer must always be one of the three arguments, whatever the input.
    for (const n of [0, 1, 2, 5, 11, 21, 111, -3, 2.5]) {
      assert.ok(
        (ITEM as readonly string[]).includes(pick(n)),
        `${n} produced '${pick(n)}', which is none of the three forms given`,
      );
    }
  });
});

/**
 * The header stopped being true before it stopped being read.
 *
 * `lib/plural.ts` was written for the translation maps and its doc comment is
 * fifty lines about the six languages. Two callers arrived that are not the app
 * — a build-time gate printing "1 advisory" and a test helper printing "only 1
 * probe" — and the paragraph naming them is prose, so the fourth caller would
 * leave it describing three and nothing would say so.
 */
/** The module the rule lives in. It is not a caller of itself. */
const NOT_CALLERS = ["lib/plural.ts"];

describe("who the rule says asks it", () => {
  it("names every module that imports it, so a new caller cannot arrive unlisted", () => {
    // Suites are excluded: a case importing `plural` to test it is not a
    // caller of the rule in the sense the paragraph is about. A HELPER is —
    // it builds a message somebody reads — which is why the walk keeps
    // `__tests__/helpers/` and drops `*.test.ts`.
    const IMPORTS_PLURAL = /from "(?:@\/lib\/plural|\.\/plural|\.\.\/lib\/plural)"/;
    const callers = [
      ...sourceFiles("lib", "scripts", "app", "components").filter(
        (file) => !NOT_CALLERS.includes(file) && IMPORTS_PLURAL.test(sourceCode(file)),
      ),
      ...suiteFiles()
        .filter((file) => !file.endsWith(".test.ts") && IMPORTS_PLURAL.test(suiteCode(file)))
        .map((file) => `__tests__/${file}`),
    ];
    assert.ok(
      callers.length >= 3,
      measuredFloor(callers.length, 3, "caller(s) of lib/plural outside its own suites"),
    );

    const doc = moduleDoc(readRepoFile("lib/plural.ts"));
    const unnamed = callers.filter((caller) => !doc.includes(caller));
    assert.deepEqual(
      unnamed,
      [],
      `these modules import the plural rule and the doc comment in lib/plural.ts does not name them: ${unnamed.join(", ")} — the "who else asks" paragraph is what tells the next reader whether this module is about translations or about agreement`,
    );
  });
});

describe("the one-versus-many rule lives in one module", () => {
  /**
   * `count === 1 ? one : other`, wherever a module writes it out.
   *
   * The rule was in this module for the app's six locales, and the tooling
   * wrote it again anyway: `lib/audit-baseline.ts` had its own `plural`,
   * `lib/ships-to-client.ts` two ternaries, `lib/provenance-tables.ts` two more
   * (one of them twice in a sentence), `lib/oldest-record.ts` one that also
   * spelled the count, and `__tests__/helpers/coverage-floor.ts` the `(s)`
   * inflection. Six copies of one fact, and the way that ends is a message
   * reading "1 probes" — which is exactly what it did, in six suites at once,
   * before the entry above this one.
   *
   * A CI message is not a different rule from a UI string: exactly one takes
   * the singular, and zero does not.
   *
   * SIX SPELLINGS, not one. The first version of this read `=== 1 ?` — the
   * spelling the six modules it was written from happened to use — so a
   * seventh copy written `!== 1 ? many : one`, `> 1 ?`, `<= 1 ?`, `< 2 ?` or
   * `>= 2 ?` said the same thing and passed. That is the shape three entries
   * in `.tasks/` are about: a rule read off the offenders in front of it.
   *
   * The condition is what is matched, not the branches. A copy that picks
   * between two VARIABLES — `count === 1 ? one : many`, which is exactly what
   * `audit-baseline` had — is the one worth catching most, and a rule keyed on
   * a string literal after the `?` would miss it.
   *
   * `=== 2` and `> 2` are absent because they are not this rule. Widening to
   * "any comparison against a small number" would sweep in bounds checks and
   * make the exemption list the thing that carries the meaning.
   */
  /**
   * The six comparisons, as a fragment both rules are built from.
   *
   * They were written out twice — once inside the ternary pattern and once
   * inside the `if` pattern — which is two places to add a seventh spelling and
   * one of them to forget. The alternation is the rule; what differs between
   * the two readers is only what wraps it.
   */
  const COUNT_COMPARISON = "(?:===\\s*1|!==\\s*1|>\\s*1|<=\\s*1|<\\s*2|>=\\s*2)";

  const INLINE_RULE = new RegExp(`${COUNT_COMPARISON}\\s*\\?`);

  it("matches every spelling it claims, and the near misses it disclaims", () => {
    // The widened rule was proved on four broken trees, planted by hand in a
    // module that had just had the rule taken out of it, and the proof is a
    // paragraph in `.tasks/`. A rule nobody has watched refuse anything is one
    // that reads as passing whether it works or not — the argument this
    // repository has spent four entries applying to `network-refusal.test.ts`,
    // owed here too, and cheaper: the offenders are strings.
    //
    // Both halves. A rule that matched everything would pass the first loop
    // and is what the second is for: `=== 2` and `> 2` are a different
    // question, and a bounds check is not this rule at all.
    for (const spelling of [
      "n === 1 ? one : many",
      "n !== 1 ? many : one",
      "n > 1 ? many : one",
      "n <= 1 ? one : many",
      "n < 2 ? one : many",
      "n >= 2 ? many : one",
      // Spacing is a style question and the sweep reads whatever prettier left.
      "count===1?one:many",
    ]) {
      assert.match(
        spelling,
        INLINE_RULE,
        `\`${spelling}\` picks a form by count and the sweep does not read it as one, so a copy written that way is invisible`,
      );
    }

    for (const notThisRule of [
      "n === 2 ? pair : rest",
      "n > 2 ? crowd : few",
      "items.length >= 2 && items[1]",
      "for (let i = 1; i < 2; i += 1)",
      // The known hole, pinned rather than implied: a two-line `if` says the
      // same thing and no single-line pattern reads it. `.tasks/` says so and
      // this is where a reader meets it.
      "if (n === 1) { return one; } return many;",
    ]) {
      assert.doesNotMatch(
        notThisRule,
        INLINE_RULE,
        `\`${notThisRule}\` is not the one-versus-many rule and the sweep reads it as one, so the exemption list would carry the meaning`,
      );
    }
  });

  /**
   * The `if` half of the rule, which the single-line pattern cannot read.
   *
   * `if (n === 1) { return one; } return many;` says exactly what the ternary
   * says, over two lines, and the disclaim list above pins that as a hole. This
   * is the measurement of how big it is: three modules in the swept tree write
   * an `if` whose condition compares a count against 1 or 2, and not one of
   * them is an inflection.
   *
   *   `list.length < 2`     — a group needs two rows to be a duplicate
   *   `value.length <= 1`   — a trailing separator cannot be trimmed off ""
   *   `starts.length > 1`   — a marker that no longer identifies one section
   *
   * So the hole is empty today, and closing it by widening the rule to
   * conditions would fail three bounds checks and put their names in an
   * exemption list — the arrangement the rule's own comment refuses. Pinning
   * the lookalikes instead means a real two-line inflection arrives as an
   * unsanctioned module with a path, and whoever adds one has to decide what
   * the sweep should do rather than never hearing about it.
   */
  const TWO_LINE_RULE = new RegExp(`if\\s*\\([^)]*${COUNT_COMPARISON}\\s*\\)`);

  it("has an if-shaped hole, and these three are what is in it", () => {
    assertOnlyTheseMatch({
      rule: TWO_LINE_RULE,
      files: sourceFiles("lib", "scripts", "__tests__/helpers"),
      read: sourceCode,
      expected: [
        "lib/db-duplicates.ts",
        "lib/guard-root.ts",
        "lib/privacy-translated-section.ts",
      ],
      subject: "modules",
      what: "compare a count against 1 or 2 in an `if`",
    });
  });

  it("is not written out again anywhere else in the tree", () => {
    assertOnlyTheseMatch({
      rule: INLINE_RULE,
      files: sourceFiles("lib", "scripts", "__tests__/helpers"),
      read: sourceCode,
      // The rule's own module, and the one module that may not import it:
      // `oldest-record.ts` is a documented LEAF — no imports, so any evaluator
      // can reach for it and it can never close a cycle — and
      // `oldest-record.test.ts` asserts that. Two words are not worth trading
      // that for, so it writes the rule out and is named here rather than
      // being quietly missed.
      //
      // Read comment-stripped, so
      // `i18n-source.ts` — which quotes `Number(count) === 1 ? "item" :
      // "items"` in prose, as the example of the shape its scanner cannot see
      // — is not an offender and does not need exempting: a sweep that made it
      // rewrite that sentence would be reading a comment as code.
      expected: ["lib/plural.ts", "lib/oldest-record.ts"],
      subject: "modules",
      what: "spell out the one-versus-many rule",
    });
  });
});
