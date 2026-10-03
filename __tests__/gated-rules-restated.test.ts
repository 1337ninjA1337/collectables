/**
 * Nobody writes the gated subset's size down and is believed either.
 *
 * WHAT THIS IS ABOUT. `gate-legs-restated.test.ts` exists because `verify`'s
 * leg count was stated in prose in five places and derived in none, and four
 * of the five said eight on the day the ninth landed. `GATED_RULES` is the
 * same shape one directory over: the list was three lines of data in
 * `lib/eslint-gate.ts`, and the sentence naming its size was written by hand
 * into CLAUDE.md, `eslint.config.js`, `lib/lint-guards.ts`,
 * `scripts/check-eslint-gate.ts`, the list's own doc comment and two comments
 * inside `eslint-gate.test.ts`.
 *
 * This header quotes none of those sentences in a shape the table below can
 * read, deliberately: a sweep that contains its own needle is its own only
 * offender, and the alternative here — an exemption for this file — would be a
 * hole kept open for a quotation.
 *
 * On 2026-10-03 the list went from three to five — `react-hooks/globals` and
 * `import/export`, the two of the four unread ERRORS that had a `why` sentence
 * in them — and every one of those seven sentences was wrong until it was
 * edited by hand. This file is why the next one will not be.
 *
 * ## The populations
 *
 *   1. the COUNT of `GATED_RULES` — the spellings of it the tree uses, which
 *      are in `CLAIM_SHAPES` and nowhere else,
 *   2. the COUNT of `ZEROED_RULES`, the second list, which is a different
 *      number stated in the same paragraphs,
 *   3. the NEXT position, when prose names one: the list's own doc comment
 *      says the one after these would be welcome and names its ordinal.
 *
 * ## What it leaves out
 *
 * The same honest limit as the leg sweep: it reads number WORDS in the shapes
 * the table below carries, so `a 6th rule` and "all of them" are invisible to
 * it. The floor case is what keeps that from being the whole story — a rewrite
 * that drops the population below what stands today turns this suite red
 * rather than passing over documents it can no longer read.
 *
 * `.tasks/` is deliberately not swept, for the reason the leg sweep gives: its
 * entries are dated records, and "the three rules" in a 2026-09-27 entry is
 * correct history.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GATED_RULES, ZEROED_RULES } from "@/lib/eslint-gate";

import { markdownFiles } from "./helpers/markdown-files";
import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";
import { suiteFiles } from "./helpers/suite-files";

const TOTAL = GATED_RULES.length;
const ZEROED = ZEROED_RULES.length;

/** The number words prose actually uses here. */
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

const ORDINAL_WORDS = [
  "zeroth",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
] as const;

const word = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const ordinal = (n: number): string => ORDINAL_WORDS[n] ?? `${String(n)}th`;

/**
 * A file's prose, with the comment furniture removed and the lines joined.
 *
 * Both halves are load-bearing for the same reason they are in the leg sweep:
 * the claims live in JSDoc, so a sentence wrapped across two lines reads as
 * `fails on five * rules` until the continuation asterisks go, and a claim
 * that wraps mid-phrase is invisible until the newlines collapse.
 */
function prose(relative: string): string {
  return readRepoFile(relative)
    .replace(/^\s*(?:\/\*\*|\*\/|\*|\/\/)/gm, " ")
    .replace(/\s+/g, " ");
}

/** Every file a sentence about the gated subset could plausibly live in. */
function proseFiles(): readonly string[] {
  return [
    ...markdownFiles(".", "docs", ".github"),
    ...sourceFiles("lib", "scripts"),
    ...suiteFiles().map((relative) => `__tests__/${relative}`),
    "eslint.config.js",
  ];
}

type Population = "total" | "zeroed" | "next";

interface Claim {
  readonly file: string;
  readonly phrase: string;
  readonly said: string;
  readonly population: Population;
}

/**
 * The shapes a claim about the list's size is written in.
 *
 * Every one of these is a sentence in the tree today. The `rules.length`
 * interpolations in `formatGateReport` spell the same words — `${rules.length}
 * gated rule(s)` — and fall out because `${rules.length}` is not a number
 * word, which is the filter below rather than an exclusion list.
 */
const CLAIM_SHAPES: readonly (readonly [Population, RegExp])[] = [
  ["total", /\b([a-z]+)\s+gated rules?\b/gi],
  ["total", /\bfails?(?: the run)? on\s+([a-z]+)\s+rules\b/gi],
  ["total", /\b([a-z]+)\s+rules?\s+fail(?:s)? the run\b/gi],
  ["zeroed", /\b([a-z]+)\s+zeroed rules?\b/gi],
  ["zeroed", /\b([a-z]+)\s+rules?\s+held at zero\b/gi],
  ["next", /\bA\s+([a-z]+)\s+is welcome\b/gi],
];

/** Every claim in the tree, in the shapes above. */
function claims(): readonly Claim[] {
  return proseFiles().flatMap((file) => {
    const text = prose(file);
    return CLAIM_SHAPES.flatMap(([population, pattern]) =>
      [...text.matchAll(pattern)]
        .filter((match) =>
          population === "next"
            ? ORDINAL_WORDS.includes(match[1].toLowerCase() as (typeof ORDINAL_WORDS)[number])
            : NUMBER_WORDS.includes(match[1].toLowerCase() as (typeof NUMBER_WORDS)[number]),
        )
        .map((match) => ({
          file,
          phrase: match[0].trim(),
          said: match[1].toLowerCase(),
          population,
        })),
    );
  });
}

/** What each population's claim should say, spelled the way prose spells it. */
function expected(population: Population): readonly string[] {
  if (population === "total") return [word(TOTAL)];
  if (population === "zeroed") return [word(ZEROED)];
  return [ordinal(TOTAL + 1)];
}

describe("every sentence about the gated subset's size agrees with the list", () => {
  it("states the count the list actually has", () => {
    const wrong = claims()
      .filter((claim) => claim.population === "total")
      .filter((claim) => !expected("total").includes(claim.said));

    assert.deepEqual(
      wrong.map((claim) => `${claim.file}: "${claim.phrase}" — the list has ${String(TOTAL)}`),
      [],
      "GATED_RULES moved and a sentence about it did not. The list is the fact; these are restatements.",
    );
  });

  it("states the count the SECOND list has, which is a different number", () => {
    // `ZEROED_RULES` arrived on 2026-10-03 with three entries and its own set
    // of sentences, in the same documents. Two lists in one paragraph is
    // exactly the shape that gets edited half way.
    const wrong = claims()
      .filter((claim) => claim.population === "zeroed")
      .filter((claim) => !expected("zeroed").includes(claim.said));

    assert.deepEqual(
      wrong.map(
        (claim) => `${claim.file}: "${claim.phrase}" — the zeroed list has ${String(ZEROED)}`,
      ),
      [],
      "ZEROED_RULES moved and a sentence about it did not",
    );
  });

  it("names the right NEXT position when it names one", () => {
    const wrong = claims()
      .filter((claim) => claim.population === "next")
      .filter((claim) => !expected("next").includes(claim.said));

    assert.deepEqual(
      wrong.map(
        (claim) => `${claim.file}: "${claim.phrase}" — the next one would be the ${ordinal(TOTAL + 1)}`,
      ),
      [],
      "a rule joining the list moves the position the next one would take",
    );
  });

  it("is reading a population rather than passing over silence", () => {
    // The anti-vacuous half. A rewrite that phrases every one of these
    // sentences in a shape the table cannot read would leave both cases above
    // green over a tree where nothing is checked at all.
    const found = claims();
    assert.ok(
      found.length >= 6,
      `only ${String(found.length)} claim(s) matched — the sweep has stopped reading the sentences it exists for`,
    );
    assert.ok(
      new Set(found.map((claim) => claim.file)).size >= 4,
      "the claims are spread across at least four files; one file matching all of them means the sweep narrowed",
    );
    assert.ok(
      found.some((claim) => claim.population === "next"),
      "the NEXT-position claim in lib/eslint-gate.ts is the one that rots silently",
    );
    assert.ok(
      found.some((claim) => claim.population === "zeroed"),
      "the second list's size is stated in prose too, and it is a different number from the first's",
    );
  });
});
