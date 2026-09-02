import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";

import { ACCEPTED_HIGH_ADVISORIES, type AcceptedAdvisory } from "@/lib/audit-baseline";
import { LINT_ALL_EXEMPT, LINT_GUARDS } from "@/lib/lint-guards";
import {
  evaluateShipsToClient,
  formatShipsToClientReport,
  isShipsToClientClean,
} from "@/lib/ships-to-client";

import { installedPackageFiles, readInstalledFile } from "./helpers/installed-packages";
import { readRepoFile } from "./helpers/repo-file";

/**
 * `shipsToClient` stops being a sentence.
 *
 * It is the half of every exemption that makes a high advisory acceptable
 * rather than urgent — "the vulnerable code never runs where a user's input
 * can reach it" — and until this guard existed nothing re-derived it. The one
 * entry that ever DID ship was `nanoid`, found by a person reading call sites
 * on a list a gate had no opinion about.
 *
 * The bundle carries no package names, so each `shipsToClient: false` entry
 * names a string literal out of its own package's code and the guard greps the
 * exported chunks for it. What that can and cannot say is argued in
 * `lib/ships-to-client.ts`; these cases pin the behaviour and, below, the one
 * fact the guard itself cannot check — that the fingerprint is a real string
 * in the package rather than a typo nothing will ever match.
 */

const buildTime = (name: string, fingerprint?: string): AcceptedAdvisory => ({
  package: name,
  advisories: ["GHSA-aaaa-aaaa-aaa1"],
  shipsToClient: false,
  ...(fingerprint === undefined ? {} : { absentFingerprint: fingerprint }),
  why: "build-time only, a sentence long enough to satisfy the list's own rule",
});

const shipping = (name: string, reachedFrom?: readonly string[]): AcceptedAdvisory => ({
  package: name,
  advisories: ["GHSA-aaaa-aaaa-aaa2"],
  shipsToClient: true,
  ...(reachedFrom === undefined ? {} : { reachedFrom }),
  why: "reaches the client; no bundled call site passes the shape the advisory needs",
});

const chunks = (entries: Record<string, string>): ReadonlyMap<string, string> =>
  new Map(Object.entries(entries));

/**
 * The other half of the column, and the half that shipped.
 *
 * `absentFingerprint` made "build-time only" an assertion the build can
 * refute. The entries that say they DO reach the client were skipped by that
 * guard on the correct reasoning that no grep can settle reachability — and
 * so nothing asked them anything at all, which is precisely the state the
 * whole column was in. `nanoid` is the one entry that was ever in this
 * position, and being wrong about it means shipping a vulnerability rather
 * than mislabelling a build tool.
 *
 * What is checkable is not the argument but its ADDRESS: an entry that ships
 * has to name the call sites its acceptance was argued from, so the next
 * person can re-read them. The suite below then holds those paths to still
 * existing and still naming the package.
 */
describe("evaluateShipsToClient — the half that reaches the client", () => {
  it("reports an entry that ships and names no call sites", () => {
    const verdict = evaluateShipsToClient([shipping("nanoid")], chunks({}));
    assert.deepEqual(verdict.unargued, ["nanoid"]);
    assert.equal(isShipsToClientClean(verdict), false);
    assert.match(
      formatShipsToClientReport("check", verdict),
      /nanoid is accepted WHILE reaching the client and names no `reachedFrom`/,
    );
  });

  it("accepts one that names them, and counts it", () => {
    const verdict = evaluateShipsToClient([shipping("nanoid", ["lib/ids.ts"])], chunks({}));
    assert.deepEqual(verdict.unargued, []);
    assert.equal(verdict.argued, 1);
    assert.equal(isShipsToClientClean(verdict), true);
  });

  it("treats an empty call-site list as no list at all", () => {
    // `reachedFrom: []` is what a shape rule satisfied to satisfy the compiler
    // looks like, and it argues exactly as much as omitting the field.
    const verdict = evaluateShipsToClient([shipping("nanoid", [])], chunks({}));
    assert.deepEqual(verdict.unargued, ["nanoid"]);
  });

  it("reports call sites named on a build-time-only entry", () => {
    // The two fields answer different questions; both being set means one of
    // them is wrong, and neither is safe to guess at.
    const verdict = evaluateShipsToClient(
      [{ ...buildTime("postcss", "CssSyntaxError"), reachedFrom: ["lib/ids.ts"] }],
      chunks({}),
    );
    assert.deepEqual(verdict.misplaced, ["postcss"]);
    assert.equal(isShipsToClientClean(verdict), false);
  });

  it("says nothing about reachability on a run with no shipping entry", () => {
    // Today's tree, and the reason the clause is conditional: "0 reachability
    // claims" on every green run is the noise the audit gate's OK line was
    // rewritten to stop printing.
    const printed = formatShipsToClientReport(
      "check",
      evaluateShipsToClient([buildTime("postcss", "CssSyntaxError")], chunks({})),
    );
    assert.match(printed, /OK — 1 "build-time only" claim the bundle does not contradict\.$/);
    assert.doesNotMatch(printed, /reaches the client/);
  });

  it("names the reachability count on the OK line when there is one", () => {
    const printed = formatShipsToClientReport(
      "check",
      evaluateShipsToClient(
        [buildTime("postcss", "CssSyntaxError"), shipping("nanoid", ["lib/ids.ts"])],
        chunks({}),
      ),
    );
    assert.match(printed, /1 "reaches the client" claim names its call sites\.$/);
  });
});

describe("evaluateShipsToClient — the bundle answers, not the author", () => {
  it("reports a build-time-only package whose fingerprint is in a chunk", () => {
    const verdict = evaluateShipsToClient(
      [buildTime("postcss", "CssSyntaxError")],
      chunks({ "dist/entry.js": "…minified…CssSyntaxError…more…" }),
    );
    assert.deepEqual(verdict.contradicted, [
      { package: "postcss", fingerprint: "CssSyntaxError", foundIn: ["dist/entry.js"] },
    ]);
    assert.equal(isShipsToClientClean(verdict), false);
  });

  it("names every chunk the fingerprint is in, in a stable order", () => {
    // A finding has to name a file somebody will open, and a list that
    // reshuffles between runs is one nobody can diff.
    const verdict = evaluateShipsToClient(
      [buildTime("postcss", "CssSyntaxError")],
      chunks({
        "dist/z.js": "CssSyntaxError",
        "dist/a.js": "CssSyntaxError",
        "dist/clean.js": "nothing here",
      }),
    );
    assert.deepEqual(verdict.contradicted[0].foundIn, ["dist/a.js", "dist/z.js"]);
  });

  it("passes when the fingerprint is absent, and says how many it asked", () => {
    const verdict = evaluateShipsToClient(
      [buildTime("postcss", "CssSyntaxError"), buildTime("image-size", "input should be a")],
      chunks({ "dist/entry.js": "a bundle with neither string in it" }),
    );
    assert.deepEqual(verdict.contradicted, []);
    assert.equal(verdict.checked, 2);
    assert.equal(isShipsToClientClean(verdict), true);
    assert.match(formatShipsToClientReport("check", verdict), /OK — 2 "build-time only" claims/);
  });

  it("fails an entry that claims build-time-only and names nothing to look for", () => {
    // An entry with nothing to check looks exactly like an entry that passed,
    // which is the shape the whole column was in before this existed.
    const verdict = evaluateShipsToClient(
      [buildTime("mystery")],
      chunks({ "dist/entry.js": "anything" }),
    );
    assert.deepEqual(verdict.unmeasured, ["mystery"]);
    assert.equal(verdict.checked, 0, "an unmeasured claim must not be counted as measured");
    assert.equal(isShipsToClientClean(verdict), false);
    assert.match(formatShipsToClientReport("check", verdict), /nothing checked it/);
  });

  it("never examines an entry that already says it ships", () => {
    // Their exemption argues the vulnerable PATH is unreachable from this
    // app's call sites, which no amount of grepping settles — and finding a
    // package that says it ships would confirm nothing.
    const verdict = evaluateShipsToClient(
      [
        {
          package: "nanoid",
          advisories: ["GHSA-aaaa-aaaa-aaa1"],
          shipsToClient: true,
          why: "vulnerable path unreachable from any bundled call site",
        },
      ],
      chunks({ "dist/entry.js": "nanoid is right here in the bundle" }),
    );
    assert.deepEqual(verdict.contradicted, []);
    assert.deepEqual(verdict.unmeasured, []);
    assert.equal(verdict.checked, 0);
  });

  it("prints the string it found rather than asserting what it means", () => {
    // A literal is not proof of the package. The report says what is in the
    // bundle and leaves the reading of the chunk to a person.
    const printed = formatShipsToClientReport(
      "check",
      evaluateShipsToClient(
        [buildTime("postcss", "CssSyntaxError")],
        chunks({ "dist/entry.js": "CssSyntaxError" }),
      ),
    );
    assert.match(printed, /SHIPPED {2}CssSyntaxError/);
    assert.match(printed, /in dist\/entry\.js/);
    assert.match(printed, /A string is not proof of the package/);
  });

  it("treats an empty fingerprint as no fingerprint, not as a match on everything", () => {
    // `"".includes` is true of every chunk, so a blank would report every
    // accepted package as shipped — the loudest possible way to be useless.
    const verdict = evaluateShipsToClient(
      [buildTime("blank", "")],
      chunks({ "dist/entry.js": "anything at all" }),
    );
    assert.deepEqual(verdict.contradicted, []);
    assert.deepEqual(verdict.unmeasured, ["blank"]);
  });
});

/**
 * The half the guard cannot check about itself.
 *
 * A fingerprint that is not actually in the package can never appear in a
 * bundle either, so the guard passes forever and says the claim was measured.
 * That is a fact about the installed dependency rather than about the build,
 * which is why it lives here and not in `check-ships-to-client`.
 */
describe("every fingerprint is a real string in its own package", () => {
  const buildTimeEntries = ACCEPTED_HIGH_ADVISORIES.filter((entry) => !entry.shipsToClient);

  it("requires a fingerprint of every entry that claims it does not ship", () => {
    const missing = buildTimeEntries
      .filter((entry) => (entry.absentFingerprint ?? "") === "")
      .map((entry) => entry.package);
    assert.deepEqual(
      missing,
      [],
      `these entries claim "build-time only" and name no string to look for, so nothing checks them: ${missing.join(", ")}`,
    );
  });

  for (const entry of ACCEPTED_HIGH_ADVISORIES.filter(
    (candidate) => !candidate.shipsToClient && (candidate.absentFingerprint ?? "") !== "",
  )) {
    it(`finds ${entry.package}'s fingerprint in node_modules/${entry.package}`, () => {
      // Its own installed code, its own nested dependencies excluded: a string
      // borrowed from something the package merely depends on would go missing
      // the day that dependency moves, and the guard would quietly stop asking.
      // Through `helpers/installed-packages`, which is where the exclusion and
      // the reason this read is different from every other read here live.
      const files = installedPackageFiles(entry.package);
      assert.ok(files.length > 0, `no JavaScript under node_modules/${entry.package}`);
      const found = files.some((relative) =>
        readInstalledFile(entry.package, relative).includes(entry.absentFingerprint ?? ""),
      );
      assert.ok(
        found,
        `\`${entry.absentFingerprint ?? ""}\` is not in ${entry.package}'s own code, so it can never appear in a bundle either — the guard would pass forever while reporting the claim as measured`,
      );
    });
  }

  it("holds every named call site to existing and still using the package", () => {
    // The argument is not checkable; its ADDRESS is. A path that has been
    // deleted or refactored away leaves an acceptance pointing at nothing,
    // which reads exactly like one somebody re-read this morning.
    //
    // Vacuous today — the baseline has no `shipsToClient: true` entry, and
    // `nanoid` was the only one there has ever been. That is why the rule is
    // here before it is needed: the day one is added, its call sites are
    // asked for by a red run rather than by a reviewer noticing.
    for (const entry of ACCEPTED_HIGH_ADVISORIES.filter((candidate) => candidate.shipsToClient)) {
      for (const site of entry.reachedFrom ?? []) {
        const source = readRepoFile(site);
        assert.ok(
          source.includes(entry.package),
          `${entry.package}'s acceptance is argued from ${site}, which no longer names the package — re-read the argument rather than re-pointing the path`,
        );
      }
    }
  });

  it("keeps each fingerprint long enough that a coincidence is unlikely", () => {
    // Not a rule with a principled threshold — a short literal is simply more
    // likely to be somebody else's. The two in the tree are 14 and 47 chars.
    for (const entry of buildTimeEntries) {
      assert.ok(
        (entry.absentFingerprint ?? "").length >= 12,
        `${entry.package}: a fingerprint this short will match something that is not this package`,
      );
    }
  });

  it("never uses the package's own name, which the bundle carries anyway", () => {
    // `image-size` is the case: the bundle contains `image-size-select-actual`,
    // an icon name, and always has. A name-shaped fingerprint would report a
    // finding on every run and be switched off within a week.
    for (const entry of buildTimeEntries) {
      assert.ok(
        !(entry.absentFingerprint ?? "").includes(entry.package),
        `${entry.package}: a fingerprint containing the package name is the search that does not work`,
      );
    }
  });
});

describe("the guard is wired where a green run depends on it", () => {
  it("package.json declares the script and verify:dist chains it", () => {
    const pkg = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts["lint:ships-to-client"], "tsx scripts/check-ships-to-client.ts");
    assert.match(
      pkg.scripts["verify:dist"],
      /npm run lint:ships-to-client/,
      "a post-build guard outside `verify:dist` is one `npm run verify` does not run",
    );
  });

  it("ci.yml runs it as its own named step", () => {
    assert.match(
      readRepoFile(path.join(".github", "workflows", "ci.yml")),
      /^\s*run: npm run lint:ships-to-client$/m,
    );
  });

  it("says why it is not a lint:all guard, like the three beside it", () => {
    assert.ok(
      !LINT_GUARDS.some((guard) => guard.npmScript === "lint:ships-to-client"),
      "it needs dist/, so it cannot run in the source-only aggregator",
    );
    assert.match(
      LINT_ALL_EXEMPT["lint:ships-to-client"] ?? "",
      /dist\//,
      "an exemption has to name the reason, or lint-guards.test.ts fails it",
    );
  });
});
