/**
 * Nobody writes the gate's size down and is believed.
 *
 * WHAT THIS IS ABOUT. `npm run verify` has nine legs. That number is stated in
 * prose in five places — CLAUDE.md's Commands section, SECURITY.md's "a red
 * gate here may not be your branch's fault", the doc comment above
 * `PUBLISHED_ELSEWHERE_NOTE` in `lib/audit-baseline.ts`, and the headers of
 * `audit-baseline.test.ts` and `verify-gate-script.test.ts` — and each one was
 * written by hand on the day its author added a leg.
 *
 * On 2026-09-02 `lint:ships-to-client` became the ninth. FOUR of those copies
 * still said eight, and they were found by a grep somebody thought to run, in
 * the same session that added the leg. The `.tasks/` entry filed it as the
 * fifth occurrence of the pattern: a fact derived in one place and restated in
 * several, where the derivation grows correctly and every sentence about it
 * does not.
 *
 * `verify-gate-script.test.ts` is the reason the STEP LIST cannot rot — it
 * reads ci.yml, so a leg that joins CI either joins `verify` or turns that
 * suite red. This file is the same argument for the sentences ABOUT the list.
 *
 * ## What is checked, and what that leaves out
 *
 * Three claims, all derived from `helpers/gate-legs.ts`:
 *
 *   1. the COUNT ("nine legs", "the NINE steps CI runs"),
 *   2. the HERMETIC count, which is the complement of the legs that read
 *      something outside the tree ("the other eight read the tree"),
 *   3. the NEXT position, when prose names one ("a tenth leg that shelled out
 *      to a registry would make this sentence false").
 *
 * Plus the ordered list itself: CLAUDE.md prints the nine legs joined by
 * arrows, and that string is built here from `GATE_LEG_LABELS` rather than
 * compared to a copy of itself.
 *
 * It reads number WORDS. `a 9th leg`, `the gate's 9 legs`, "all of them" and
 * "every leg but one" are all invisible to it, and a claim phrased in a shape
 * the table below does not carry is not a claim as far as this file is
 * concerned. That is the honest limit of a prose scan, and the anti-vacuous
 * case is what keeps it from being the whole story: if a rewrite drops the
 * population below the six claims standing today, this suite goes red rather
 * than passing over a document it can no longer read.
 *
 * `.tasks/` is deliberately not swept. Its entries are dated records of what
 * was true on the day they were written — "the eight legs" in a 2026-09-01
 * entry is correct history, and a rule that made history red would be asking
 * for the log to be rewritten.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GATE_LEG_LABELS,
  gateLegs,
  legReadsOutsideTheTree,
} from "./helpers/gate-legs";
import { markdownFiles } from "./helpers/markdown-files";
import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";
import { suiteFiles } from "./helpers/suite-files";

const LEGS = gateLegs();
const TOTAL = LEGS.length;
const HERMETIC = LEGS.filter((leg) => legReadsOutsideTheTree(leg) === undefined).length;
const NETWORK = TOTAL - HERMETIC;

/** The number words prose actually uses here, both directions. */
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
  "eleven",
  "twelve",
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
  "eleventh",
  "twelfth",
] as const;

const word = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const ordinal = (n: number): string => ORDINAL_WORDS[n] ?? `${String(n)}th`;

/**
 * A file's prose, with the comment furniture removed and the lines joined.
 *
 * Both halves are load-bearing. The claims live in JSDoc, so a sentence
 * wrapped across three lines reads as `A * ninth leg` until the continuation
 * asterisks go — the first draft of this file matched four of the five copies
 * and silently missed the one in `lib/audit-baseline.ts` for exactly that
 * reason. And a claim that wraps mid-phrase (`the other\neight`) is invisible
 * to any pattern until the newlines collapse.
 */
function prose(relative: string): string {
  return readRepoFile(relative)
    .replace(/^\s*(?:\/\*\*|\*\/|\*|\/\/)/gm, " ")
    .replace(/\s+/g, " ");
}

/**
 * Every file a sentence about the gate could plausibly live in.
 *
 * The prose (root markdown, `docs/`, the PR template) plus the code that
 * documents itself (`lib/`, `scripts/`, and the suites, whose headers carry
 * two of the five copies). Roots are arguments rather than a hardcoded walk,
 * which is what `source-files-helper.test.ts` asks of any sweep here.
 */
function proseFiles(): readonly string[] {
  return [
    ...markdownFiles(".", "docs", ".github"),
    ...sourceFiles("lib", "scripts"),
    ...suiteFiles().map((relative) => `__tests__/${relative}`),
  ];
}

/** What a claim's number is supposed to be, once the legs are counted. */
type Population = "total" | "hermetic" | "next";

interface Claim {
  readonly file: string;
  readonly phrase: string;
  readonly said: string;
  readonly population: Population;
}

/**
 * The shapes a claim about the gate's size is written in, each with the
 * population it is counting.
 *
 * Every one of these is a sentence that exists in the tree today, not a shape
 * somebody might use — the table was built by sweeping for `legs`/`steps` near
 * `verify` and reading what came back. A sixth spelling arriving is the
 * expected way this rule gets extended, and the population floor below is what
 * makes the extension visible rather than optional.
 *
 * `next` is the odd one: `a tenth leg that shelled out to a registry` names
 * the position a leg WOULD take, so it is checked against a count plus one.
 * Two populations are being counted with that shape — the gate's legs, and the
 * legs that read outside the tree ("a second leg of `verify` now reads
 * something outside the tree") — so both successors are accepted. Narrowing
 * that would take a rule for telling the two apart from the words around them,
 * and the pair of them is a smaller thing to state than the rule would be.
 */
const CLAIM_SHAPES: ReadonlyArray<readonly [Population, RegExp]> = [
  ["total", /`verify`'s\s+([a-z]+)\s+(?:legs|steps)\b/gi],
  ["total", /\b([a-z]+)\s+`verify`\s+(?:legs|steps)\b/gi],
  ["total", /\b([a-z]+)\s+(?:legs|steps)\s+CI\s+runs\b/gi],
  ["total", /\bgate has\s+([a-z]+)\s+(?:legs|steps)\b/gi],
  ["hermetic", /\bthe other\s+([a-z]+)\s+(?:read the tree|give the same answer)/gi],
  ["hermetic", /\b([a-z]+)\s+of the\s+[a-z]+\s+`verify`\s+(?:legs|steps)\b/gi],
  ["next", /\ba\s+([a-z]+)\s+(?:leg|step)\b/gi],
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
          phrase: match[0],
          said: match[1].toLowerCase(),
          population,
        })),
    );
  });
}

/** What each population's claim should say, spelled the way prose spells it. */
function expected(population: Population): readonly string[] {
  if (population === "total") return [word(TOTAL)];
  if (population === "hermetic") return [word(HERMETIC)];
  return [ordinal(TOTAL + 1), ordinal(NETWORK + 1)];
}

describe("the gate's legs are derived before they are described", () => {
  it("finds the legs rather than an empty chain", () => {
    // A resolver that stopped expanding `verify` would report zero legs and
    // make every claim below fail with a number nobody wrote, which reads as
    // the prose being wrong rather than the derivation being broken.
    assert.ok(
      TOTAL >= 9,
      `only ${String(TOTAL)} legs expanded out of \`npm run verify\` — the script chain reader has broken`,
    );
    const scripts = LEGS.map((leg) => leg.script);
    for (const leg of ["typecheck", "test", "build", "lint:audit-baseline"]) {
      assert.ok(scripts.includes(leg), `\`${leg}\` is a leg of the gate and the expansion missed it`);
    }
  });

  it("counts each leg once, at the position it first runs", () => {
    // `typecheck` is reached through `lint:ci` and again through `pretest`.
    // It runs once, and a count that said ten would be the kind of number
    // nobody could check against a run.
    const scripts = LEGS.map((leg) => leg.script);
    assert.equal(new Set(scripts).size, scripts.length, `a leg is counted twice: ${scripts.join(", ")}`);
    assert.ok(
      scripts.indexOf("typecheck") < scripts.indexOf("lint:all"),
      "the cheap legs come first in the chain and must come first in the list",
    );
    assert.equal(scripts[scripts.length - 1], "lint:ships-to-client", "the last leg is the last dist/ guard");
  });

  it("names every leg, so a new one is named by whoever adds it", () => {
    const unnamed = LEGS.filter((leg) => leg.label === undefined).map((leg) => leg.script);
    assert.deepEqual(
      unnamed,
      [],
      `these legs have no prose name in GATE_LEG_LABELS: ${unnamed.join(", ")} — CLAUDE.md prints the labels, so an unnamed leg cannot be documented`,
    );
  });

  it("keeps no label for a leg the gate no longer runs", () => {
    const scripts = new Set(LEGS.map((leg) => leg.script));
    const orphans = Object.keys(GATE_LEG_LABELS).filter((script) => !scripts.has(script));
    assert.deepEqual(
      orphans,
      [],
      `GATE_LEG_LABELS names ${orphans.join(", ")}, which \`verify\` no longer runs — a label for a leg that left is a name for nothing`,
    );
  });

  it("finds exactly one leg that reads something outside the tree", () => {
    // The hermetic count every "the other eight" claim rests on. If a second
    // leg ever reaches the registry this fails here, beside the claims, rather
    // than only in verify-gate-script.test.ts's own scan.
    const reaching = LEGS.filter((leg) => legReadsOutsideTheTree(leg) !== undefined).map(
      (leg) => leg.script,
    );
    assert.deepEqual(reaching, ["lint:audit-baseline"], "the network-reading legs of the gate changed");
    assert.equal(HERMETIC, TOTAL - 1);
  });
});

describe("no document states the gate's size from memory", () => {
  it("sweeps a real population of files", () => {
    const files = proseFiles();
    assert.ok(
      files.length >= 100,
      `only ${String(files.length)} prose files swept — the walk has broken, and a broken walk agrees with every document it cannot open`,
    );
    for (const named of ["CLAUDE.md", "SECURITY.md", "lib/audit-baseline.ts"]) {
      assert.ok(files.includes(named), `${named} carries a claim about the gate and is not in the sweep`);
    }
  });

  it("still finds the claims it was written for", () => {
    // The anti-vacuous half. Six claims in five files stand today; a rewrite
    // that rephrased them all out of the table's reach would leave this suite
    // green while checking nothing, which is the exact failure the derived
    // step list in verify-gate-script.test.ts replaced.
    const found = claims();
    assert.ok(
      found.length >= 6,
      `only ${String(found.length)} claims about the gate's size found — the shapes in CLAIM_SHAPES have stopped matching the prose`,
    );
    assert.ok(
      new Set(found.map((claim) => claim.file)).size >= 4,
      `the claims found are in ${String(new Set(found.map((c) => c.file)).size)} files; five documents state this and the sweep should see them`,
    );
    for (const population of ["total", "hermetic", "next"] as const) {
      assert.ok(
        found.some((claim) => claim.population === population),
        `no ${population} claim matched — that shape's patterns are dead`,
      );
    }
  });

  it("every stated count is the count the chain actually has", () => {
    const wrong = claims()
      .filter((claim) => !expected(claim.population).includes(claim.said))
      .map(
        (claim) =>
          `${claim.file}: "${claim.phrase}" says ${claim.said}, the gate has ${word(TOTAL)} legs (${expected(claim.population).join(" or ")} expected here)`,
      );
    assert.deepEqual(
      wrong,
      [],
      `these sentences describe a gate that no longer exists:\n  ${wrong.join("\n  ")}\nThe legs are derived in __tests__/helpers/gate-legs.ts — fix the prose, not the count.`,
    );
  });

  it("reads the whole sentence, not the line it happens to be wrapped on", () => {
    // `lib/audit-baseline.ts` wraps "A\n * ninth leg" across two lines, and
    // the copy in `SECURITY.md` wraps "the other\neight". Both were invisible
    // to the first draft, so both are pinned by name: a `prose()` that stopped
    // stripping comment furniture or stopped joining lines would pass every
    // case above by finding nothing.
    // `includes`, not `assert.match`: a failed match prints the whole haystack,
    // and `lib/audit-baseline.ts` flattens to 30 KB of prose that buries the
    // one sentence the case is about.
    for (const [file, sentence] of [
      ["lib/audit-baseline.ts", "A tenth leg that shelled out"],
      ["SECURITY.md", "the other eight give the same answer"],
    ] as const) {
      assert.ok(
        prose(file).includes(sentence),
        `${file} no longer reads "${sentence}" once its comment furniture is stripped and its lines joined — either the sentence moved, or prose() stopped flattening and every sweep above is finding less than it thinks`,
      );
    }
  });
});

describe("CLAUDE.md prints the legs the gate runs, in order", () => {
  const ARROWS = LEGS.map((leg) => leg.label ?? leg.script).join(" → ");

  it("carries the derived list verbatim", () => {
    assert.ok(
      prose("CLAUDE.md").includes(ARROWS),
      `CLAUDE.md's Commands section must print the gate's legs as:\n  ${ARROWS}\nA leg was added, removed or reordered and the list did not follow.`,
    );
  });

  it("builds that list from the labels rather than from CLAUDE.md", () => {
    // The case above is only worth anything while the expected string comes
    // from the chain. Pinning a couple of the labels here means a "fix" that
    // copied CLAUDE.md's text into GATE_LEG_LABELS would still have to say
    // something false out loud.
    assert.equal(GATE_LEG_LABELS["lint:audit-baseline"], "audit baseline");
    assert.equal(GATE_LEG_LABELS["lint:ships-to-client"], "ships-to-client");
    assert.match(ARROWS, /^typecheck → lint:all → test → /);
  });
});
