/**
 * Turning `shipsToClient` from a sentence into a measurement.
 *
 * ## The column nothing checked
 *
 * Every entry on {@link ACCEPTED_HIGH_ADVISORIES} answers one question the
 * severity number cannot: does the vulnerable code reach a browser? Both
 * entries say no — "build-time only", metro's asset pipeline and
 * `@expo/metro-config`'s CSS transform — and that answer is what makes a high
 * advisory acceptable rather than urgent.
 *
 * Nothing re-derived it. `shipsToClient: false` was written by whoever added
 * the entry, on the day they added it, and stayed true by nobody's action. The
 * one entry that ever DID ship was `nanoid`, and it was found by a person
 * reading call sites rather than by any check — on an exemption list read by a
 * gate that had no opinion about the claim at all.
 *
 * Meanwhile the tooling to answer it had been built twice for other reasons:
 * `check-bundle-secrets` walks all twelve exported chunks and
 * `check-bundle-smoke` greps them for watched tokens. The question "is this
 * package in the bundle?" is the same shape as both.
 *
 * ## Why a fingerprint rather than the package name
 *
 * A minified bundle carries no package names — that is what minification is —
 * so grepping `dist/` for `postcss` answers nothing. It carries STRINGS,
 * because a minifier renames every symbol and rewrites no string literal. So
 * each `shipsToClient: false` entry names one string out of its own package's
 * code, and the presence of that string in the bundle is the finding.
 *
 * `image-size` is the case that proves the name would not do: the bundle
 * contains `image-size-select-actual`, an icon name, and always has. Its entry
 * has had to explain that in prose since the day it was written.
 *
 * ## What this can and cannot say
 *
 * A hit is strong: that string is in the bundle, and the entry says it should
 * not be. It is not proof of the package — a coincidental literal would read
 * the same, which is why the fingerprints are long and distinctive and why the
 * report names the string it found rather than asserting what it means.
 *
 * A miss is weaker, and honestly so. It says this fingerprint is absent, not
 * that no code from the package shipped: a bundler that inlined one helper
 * function and none of its strings would leave nothing to find. The claim
 * moves from "somebody wrote this down" to "the build does not contradict it",
 * which is the improvement available and not more than that.
 *
 * The other direction — that the fingerprint is a real string in that package
 * rather than a typo that can never match — is checked by
 * `ships-to-client.test.ts` against `node_modules`, because it is a fact about
 * the dependency rather than about the build.
 */

import type { AcceptedAdvisory } from "./audit-baseline";

/** One entry's fingerprint, and whether the built bundle contains it. */
export interface FingerprintSighting {
  /** The package the entry is about. */
  readonly package: string;
  /** The string looked for. */
  readonly fingerprint: string;
  /** The chunks it was found in — empty is the passing case. */
  readonly foundIn: readonly string[];
}

export interface ShipsToClientVerdict {
  /**
   * Entries claiming `shipsToClient: false` whose fingerprint is in the
   * bundle — the finding, and the reason this exists.
   */
  readonly contradicted: readonly FingerprintSighting[];
  /**
   * Entries claiming `shipsToClient: false` with no fingerprint to look for.
   *
   * Reported rather than silently skipped: an entry with nothing to check
   * looks exactly like an entry that passed, and that is the shape the whole
   * column was in before this existed.
   */
  readonly unmeasured: readonly string[];
  /** How many claims the bundle was actually asked about. */
  readonly checked: number;
  /**
   * Entries claiming `shipsToClient: true` that name no call sites.
   *
   * The half of the column that shipped. An entry here says the package
   * reaches the browser and is accepted anyway, on an argument about which
   * call sites exist — and with nothing naming them, that argument cannot be
   * re-read, only believed. `nanoid` sat in exactly this state for two months
   * and was found by a person reading, which is the same way `shipsToClient`
   * itself used to be checked.
   */
  readonly unargued: readonly string[];
  /**
   * Entries claiming `shipsToClient: false` that name call sites anyway.
   *
   * Reported rather than ignored because the two fields answer different
   * questions and a `reachedFrom` on a build-time entry means one of them is
   * wrong: either the entry ships and the boolean is stale, or the paths are
   * left over from an argument that no longer applies.
   */
  readonly misplaced: readonly string[];
  /** How many "reaches the client" claims name where they were argued from. */
  readonly argued: number;
}

/**
 * Compares every "does not reach the client" claim against the built chunks.
 *
 * Takes chunk TEXT rather than paths, the same shape `evaluateBundleSmoke`
 * takes, so the logic is testable without a build.
 *
 * `shipsToClient: true` entries are not held to the BUNDLE: they already say
 * the package ships, so finding it would confirm nothing, and their exemption
 * argues unreachability from this app's call sites, which no amount of
 * grepping can settle. They are held to naming those call sites. The argument
 * is not checkable and its address is, and an acceptance whose address is
 * missing is one nobody can re-read — which is the state `shipsToClient`
 * itself was in before the fingerprints existed, in the half where being
 * wrong means shipping a vulnerability.
 */
export function evaluateShipsToClient(
  accepted: readonly AcceptedAdvisory[],
  chunks: ReadonlyMap<string, string>,
): ShipsToClientVerdict {
  const contradicted: FingerprintSighting[] = [];
  const unmeasured: string[] = [];
  const unargued: string[] = [];
  const misplaced: string[] = [];
  let checked = 0;
  let argued = 0;
  for (const entry of accepted) {
    const sites = entry.reachedFrom ?? [];
    if (entry.shipsToClient) {
      // The bundle cannot refute an entry that says it ships. What it CAN be
      // held to is naming the call sites its acceptance was argued from.
      if (sites.length === 0) unargued.push(entry.package);
      else argued += 1;
      continue;
    }
    if (sites.length > 0) misplaced.push(entry.package);
    const fingerprint = entry.absentFingerprint;
    if (fingerprint === undefined || fingerprint === "") {
      unmeasured.push(entry.package);
      continue;
    }
    checked += 1;
    const foundIn = [...chunks]
      .filter(([, text]) => text.includes(fingerprint))
      .map(([name]) => name)
      .sort();
    if (foundIn.length > 0) {
      contradicted.push({ package: entry.package, fingerprint, foundIn });
    }
  }
  return {
    contradicted: [...contradicted].sort((a, b) => a.package.localeCompare(b.package)),
    unmeasured: unmeasured.sort(),
    checked,
    unargued: unargued.sort(),
    misplaced: misplaced.sort(),
    argued,
  };
}

/** Whether the guard passes. Both lists are failures, for different reasons. */
export function isShipsToClientClean(verdict: ShipsToClientVerdict): boolean {
  return (
    verdict.contradicted.length === 0 &&
    verdict.unmeasured.length === 0 &&
    verdict.unargued.length === 0 &&
    verdict.misplaced.length === 0
  );
}

/** Human-readable report; the CLI prints this and nothing else. */
export function formatShipsToClientReport(
  checkName: string,
  verdict: ShipsToClientVerdict,
): string {
  const lines: string[] = [];
  for (const found of verdict.contradicted) {
    lines.push(
      `${checkName}: ${found.package} is accepted as "does not reach the client" and its fingerprint is in the bundle:`,
      `  SHIPPED  ${found.fingerprint}`,
      `           in ${found.foundIn.join(", ")}`,
    );
  }
  if (verdict.contradicted.length > 0) {
    lines.push(
      "A string is not proof of the package — read the chunk before rewriting the entry. If it IS this package, the exemption's argument has to change from \"build-time only\" to one about reachability, or the advisory has to be fixed.",
    );
  }
  for (const name of verdict.unmeasured) {
    lines.push(
      `${checkName}: ${name} claims it does not reach the client and names no \`absentFingerprint\`, so nothing checked it — add a distinctive string literal from that package's own code.`,
    );
  }
  for (const name of verdict.unargued) {
    lines.push(
      `${checkName}: ${name} is accepted WHILE reaching the client and names no \`reachedFrom\`, so the argument that made it acceptable cannot be re-read — list the call sites it was argued from, or fix the advisory.`,
    );
  }
  for (const name of verdict.misplaced) {
    lines.push(
      `${checkName}: ${name} claims it does not reach the client and names \`reachedFrom\` anyway — either the boolean is stale or the paths are left over from an argument that no longer applies.`,
    );
  }
  if (isShipsToClientClean(verdict)) {
    // The second clause only when there is one: a "0 reachability claims" on
    // every green run is the noise the audit gate's OK line was rewritten to
    // stop printing.
    const reachability =
      verdict.argued === 0
        ? ""
        : `; ${String(verdict.argued)} "reaches the client" ${verdict.argued === 1 ? "claim names its" : "claims name their"} call sites`;
    lines.push(
      `${checkName}: OK — ${String(verdict.checked)} "build-time only" ${verdict.checked === 1 ? "claim" : "claims"} the bundle does not contradict${reachability}.`,
    );
  }
  return lines.join("\n");
}
