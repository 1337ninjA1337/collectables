/**
 * The legs of `npm run verify`, derived from package.json rather than counted.
 *
 * WHAT THIS IS ABOUT. The gate has nine legs today. That number, and the
 * ordered list behind it, is written out in prose in five places — CLAUDE.md's
 * Commands section, SECURITY.md's "a red gate here may not be your branch's
 * fault", `PUBLISHED_ELSEWHERE_NOTE`'s doc comment in `lib/audit-baseline.ts`,
 * and two suite headers — and every one of them was written by hand, on the
 * day its author added a leg, and stays true by nobody's action.
 *
 * It has already gone wrong twice. `lint:ships-to-client` became the ninth leg
 * on 2026-09-02 and four prose copies said EIGHT until a grep found them; the
 * same session filed that as the fifth occurrence of the pattern. `.tasks/`
 * carries the entry. Nothing in the tree relates one copy to another, so the
 * copies are found by whoever thinks to look.
 *
 * This module is the thing they can be checked against. It does not stop a
 * sentence being written; `gate-legs-restated.test.ts` is what makes writing a
 * stale one a red run.
 *
 * ## What a "leg" is
 *
 * A leaf of `verify`'s npm-script chain: a script that runs a real command
 * rather than delegating to other scripts. `verify` → `lint:ci` → `typecheck`
 * bottoms out at `tsc --noEmit`, so `typecheck` is a leg and `lint:ci` is not.
 * That is exactly the population the prose means when it says "nine steps",
 * and it is the one a contributor watches go past on a run.
 *
 * Order is the chain's order, with `pre*` hooks spliced in where npm runs
 * them, and a script reached twice counted at its FIRST position — `typecheck`
 * is reached through `lint:ci` and again through `pretest`, and it is one leg
 * that runs once, not two.
 */

import { LINT_GUARDS } from "@/lib/lint-guards";

import { readRepoFile } from "./repo-file";

const pkg = JSON.parse(readRepoFile("package.json")) as {
  scripts: Record<string, string>;
};

/** One leaf of the chain: an npm script that runs something itself. */
export interface GateLeg {
  /** The npm script name, e.g. `lint:audit-baseline`. */
  readonly script: string;
  /**
   * What the prose calls it, e.g. `audit baseline` — `undefined` for a leg
   * nobody has named yet, which is a finding rather than a default.
   */
  readonly label: string | undefined;
  /** The `scripts/*.ts` wrappers this leg runs, repo-relative. */
  readonly scriptPaths: readonly string[];
}

/**
 * The prose name of each leg, in ONE place.
 *
 * CLAUDE.md prints these joined by arrows and that string is asserted against
 * this map, so the names are not decoration: they are the vocabulary the
 * documentation is checked in. A leg with no entry here fails
 * `gate-legs-restated.test.ts` rather than quietly printing its npm script
 * name — the whole point is that adding a leg makes somebody decide what to
 * call it while they still have the context.
 */
export const GATE_LEG_LABELS: Readonly<Record<string, string>> = {
  typecheck: "typecheck",
  "lint:all": "lint:all",
  test: "test",
  "lint:audit-baseline": "audit baseline",
  build: "build",
  "lint:secrets:bundle": "bundle secrets",
  "lint:bundle-size": "bundle size",
  "lint:bundle-smoke": "bundle smoke",
  "lint:ships-to-client": "ships-to-client",
};

/** `npm run foo` / `npm test` on its own — a delegation, not a command. */
const DELEGATION = /^npm\s+(?:run\s+)?([\w:-]+)$/;

/** The script a `&&` segment delegates to, or `undefined` if it runs work. */
function delegatesTo(segment: string): string | undefined {
  const match = DELEGATION.exec(segment.trim());
  if (match === null) return undefined;
  // `npm ci` and `npm audit` are npm-shaped and are not script references;
  // only a name package.json declares counts as a delegation.
  return pkg.scripts[match[1]] === undefined ? undefined : match[1];
}

/**
 * The leaf scripts `name` reaches, in run order, first occurrence winning.
 *
 * `seen` is what makes the dedupe positional rather than a post-filter: the
 * second path to `typecheck` returns nothing at all, so the first one keeps
 * its place in the sequence. It also stops a cyclic pair of scripts — easy to
 * write, impossible to run — from hanging the suite.
 */
function legScripts(name: string, seen: Set<string>): readonly string[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const body = pkg.scripts[name];
  if (body === undefined) return [];
  // npm runs `pre<name>` before the body, so it comes first in the sequence.
  const hook = pkg.scripts[`pre${name}`] ? legScripts(`pre${name}`, seen) : [];
  const segments = body.split("&&");
  const delegated = segments.flatMap((segment) => {
    const target = delegatesTo(segment);
    return target === undefined ? [] : legScripts(target, seen);
  });
  const runsWork = segments.some((segment) => delegatesTo(segment) === undefined);
  return [...hook, ...delegated, ...(runsWork ? [name] : [])];
}

/** `scripts/foo.ts` paths named in a command, however it spells the prefix. */
function scriptPathsIn(command: string): readonly string[] {
  return [...new Set([...command.matchAll(/\bscripts\/[\w.-]+\.ts\b/g)].map((m) => m[0]))];
}

/**
 * Every leg of `npm run verify`, in the order a run meets them.
 *
 * The `lint:all` leg is the one that cannot be read off its own command line:
 * its body is `tsx scripts/lint-all.ts` and the nineteen guards it spawns come
 * from `LINT_GUARDS`, which is the registry lint-all itself iterates. Reading
 * the registry is how the guards get into the scanned set at all — a leg's
 * `scriptPaths` is meant to be everything that leg runs, not everything its
 * one-line body happens to name.
 */
export function gateLegs(): readonly GateLeg[] {
  return legScripts("verify", new Set<string>()).map((script) => {
    const own = scriptPathsIn(pkg.scripts[script]);
    const spawned = own.includes("scripts/lint-all.ts")
      ? LINT_GUARDS.map((guard) => guard.scriptPath)
      : [];
    return {
      script,
      label: GATE_LEG_LABELS[script],
      scriptPaths: [...new Set([...own, ...spawned])].sort(),
    };
  });
}

/** Every `scripts/*.ts` file the gate runs, sorted, deduped across legs. */
export function gateScriptPaths(): readonly string[] {
  return [...new Set(gateLegs().flatMap((leg) => leg.scriptPaths))].sort();
}

/**
 * What a read of something outside this repository looks like in a script
 * here, each named so a failure says what it found rather than which pattern
 * matched.
 *
 * `npx tsx` is deliberately not one: `lint:all` spawns every guard that way
 * and `tsx` is a devDependency, so it resolves locally. The marker is the
 * REMOTE read — `npm audit` asking the registry about advisories,
 * `expo install --check` asking it about compatible versions, an HTTP call.
 *
 * These lived in `verify-gate-script.test.ts` until the leg count needed them
 * too: the hermetic count ("the other eight read the tree") that SECURITY.md
 * and `lib/audit-baseline.ts` both state is the leg count minus the legs these
 * markers fire on, so it is derived from the same scan that decides the audit
 * gate is the only one.
 */
export interface NetworkMarker {
  /**
   * A short, stable name for the shape — the identifier other code keys on.
   *
   * Separate from {@link why} because the two have opposite lifetimes.
   * `network-refusal.test.ts` pairs a runtime probe with every marker, and it
   * keyed those by the sentence: rewording a failure message for clarity —
   * which is what a sentence written to be read is FOR — turned into a red run
   * about nothing, fixed by a copy-paste that teaches nobody anything.
   */
  readonly id: string;
  /**
   * Why this reaches outside the tree, as a failure message reads it.
   *
   * This is the ONLY field a failure prints — `networkMarkerHit` answers with
   * it and nothing else — so it has to say more than the pattern already
   * does. Giving the identifier job to {@link id} freed this one to be
   * reworded, and the same move makes shortening it to the id free too;
   * `verify-gate-script.test.ts` is what keeps it a sentence.
   */
  readonly why: string;
  /**
   * What the shape looks like in a script's text.
   *
   * This is the half `network-refusal.test.ts`'s probe has to agree with. The
   * probe is looked up by {@link id}, which relates the two by name only — so
   * that suite judges each probe's own SOURCE against this pattern, and a
   * probe filed under the wrong marker is a red run rather than a pass. A
   * pattern rewritten to read a different shape has to take its probe with it.
   */
  readonly pattern: RegExp;
}

/**
 * What an {@link NetworkMarker.id} looks like: a short identifier, no prose.
 *
 * Exported so the two rules that need it read one definition. One asserts
 * every id matches; the other asserts no `why` does, and a pair of rules
 * pointing at the same regex from opposite directions is the whole statement
 * that these two fields have different jobs.
 */
export const MARKER_ID_SHAPE = /^[a-z][a-z0-9-]*$/;

export const NETWORK_MARKERS: readonly NetworkMarker[] = [
  {
    id: "npm-audit",
    why: "an `npm audit` of the registry",
    pattern: /["'`]npm["'`]\s*,\s*\[\s*["'`]audit["'`]/,
  },
  {
    id: "expo-install-check",
    why: "`expo install --check`, which resolves versions against the registry",
    pattern: /["'`]npx["'`]\s*,\s*\[\s*["'`]expo["'`]\s*,\s*["'`]install["'`]/,
  },
  { id: "fetch", why: "a `fetch` call", pattern: /\bfetch\s*\(/ },
  { id: "http-client", why: "an http/https client import", pattern: /["'`]node:https?["'`]/ },
];

/** Why this source reaches outside the tree, or `undefined` if it does not. */
export function networkMarkerHit(source: string): string | undefined {
  return NETWORK_MARKERS.find((marker) => marker.pattern.test(source))?.why;
}

/**
 * Why this leg reads something outside the tree, or `undefined` if it does not.
 *
 * The suites are judged by their wrappers only: `test` is a leg, `npm test`
 * runs 1420 files, and they stub `fetch` by name in dozens of places — a
 * marker scan cannot tell a stub from a call. What answers for them instead is
 * `__tests__/test-globals.ts`, which refuses at runtime in every test process
 * what these markers look for in text — `fetch`, `http`/`https`, a spawned
 * `curl` — so a call nobody stubbed throws; `network-refusal.test.ts` owns
 * that half. The same division is written out where the scan is used.
 */
export function legReadsOutsideTheTree(leg: GateLeg): string | undefined {
  for (const relative of leg.scriptPaths) {
    const why = networkMarkerHit(readRepoFile(relative));
    if (why !== undefined) return why;
  }
  return undefined;
}
