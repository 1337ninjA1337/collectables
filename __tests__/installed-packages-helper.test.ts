/**
 * `__tests__/helpers/installed-packages.ts` — the fourth tree, and the rule
 * that says a suite reads it through one door.
 *
 * WHAT THIS IS ABOUT. Three trees the suites walk had names and a helper each:
 * the app's source (`helpers/source-files.ts`), the suites themselves
 * (`helpers/suite-files.ts`), and `dist/` (the bundle suites). `node_modules`
 * is none of those and had neither. FIVE reads of it were written out by hand,
 * in four suites, in three spellings: a package's own code
 * (`ships-to-client.test.ts`), `.bin/tsc` (`check-comment-terminators.test.ts`),
 * an installed package root and the installed tree's own root
 * (`guard-fixture-refusals.test.ts`), and `react-native-web`'s shipped files
 * through a `["node_modules", …]` array (`rnw-modal-premise.test.ts`). Two of
 * those were known when this was written; the sweep found the other three,
 * which is the whole argument for having one.
 *
 * That is the shape `source-files.ts` was extracted from at eighteen copies.
 * Five is where it is cheap to name, and the name is worth more than the lines:
 * the first three trees are facts about THIS REPOSITORY, where the same commit
 * gives the same answer next year, and this one is a fact about what npm
 * resolved on the machine the run happens on. A lockfile bump changes it with
 * no diff in anything else a suite reads.
 *
 * The helper itself spells `node_modules` once, into a const, so it never
 * matches its own pattern. The two exemptions the rule does carry are files
 * that PLANT the shape in a fixture string to prove a sweep fires — including
 * this one.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ACCEPTED_HIGH_ADVISORIES } from "@/lib/audit-baseline";

import {
  installedBin,
  installedPackageFiles,
  installedPackagePath,
  installedRoot,
  readInstalledFile,
} from "./helpers/installed-packages";
import { REPO_ROOT } from "./helpers/repo-file";
import { assertExemptionsHonest, suiteCode, suiteFiles } from "./helpers/suite-files";

describe("installedPackagePath", () => {
  it("resolves under the repository's own node_modules", () => {
    assert.equal(installedPackagePath("postcss"), path.join(REPO_ROOT, "node_modules", "postcss"));
  });

  it("takes a scoped name without the caller knowing the scope is a directory", () => {
    assert.equal(
      installedPackagePath("@expo/config", "package.json"),
      path.join(REPO_ROOT, "node_modules", "@expo", "config", "package.json"),
    );
  });
});

describe("installedPackageFiles", () => {
  it("finds a package's own JavaScript, as package-relative paths", () => {
    const files = installedPackageFiles("postcss");
    assert.ok(files.length > 0, "postcss is installed and ships JavaScript");
    for (const relative of files) {
      assert.ok(!path.isAbsolute(relative), `${relative} is absolute — callers join it themselves`);
      assert.ok(/\.(?:js|mjs|cjs)$/.test(relative), `${relative} is not JavaScript`);
    }
    // Named by its basename rather than its path: the directory a package
    // puts its code in is that package's business, and writing it out here
    // would also make this file look like a walk of the source tree to
    // `source-files-helper.test.ts`'s rule, which is about a different tree.
    assert.ok(files.some((relative) => relative.endsWith("css-syntax-error.js")));
  });

  it("excludes the package's own nested dependencies", () => {
    // The property `ships-to-client.test.ts` depends on: a fingerprint
    // borrowed from a package's nested dependency goes missing the day that
    // dependency moves, and the guard would quietly stop asking.
    //
    // The subject is chosen by reading the installed tree rather than named,
    // because which packages npm fails to hoist is a resolution detail that
    // changes with every lockfile.
    const nested = readdirSync(installedRoot(), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !entry.name.startsWith("@") &&
          existsSync(installedPackagePath(entry.name, "node_modules")),
      )
      .map((entry) => entry.name);
    assert.ok(
      nested.length > 0,
      "no installed package has nested dependencies, so this case cannot demonstrate the exclusion — npm's layout changed and this needs re-pointing rather than deleting",
    );
    for (const pkg of nested) {
      for (const relative of installedPackageFiles(pkg)) {
        assert.ok(
          !relative.split(path.sep).includes("node_modules"),
          `${pkg}: ${relative} is a nested dependency's file, not ${pkg}'s own`,
        );
      }
    }
  });

  it("answers for every package the fingerprint rule actually asks about", () => {
    // The callers, checked as a population: an entry whose package is not
    // installed would fail this suite's own subject rather than failing inside
    // ships-to-client.test.ts as a missing directory.
    const buildTime = ACCEPTED_HIGH_ADVISORIES.filter((entry) => !entry.shipsToClient);
    assert.ok(buildTime.length > 0, "the baseline has no build-time-only entries left to read");
    for (const entry of buildTime) {
      assert.ok(
        installedPackageFiles(entry.package).length > 0,
        `${entry.package} is on the baseline as build-time only and has no installed JavaScript to search`,
      );
    }
  });
});

describe("readInstalledFile", () => {
  it("reads the same bytes as the path the helper resolves", () => {
    const relative = installedPackageFiles("postcss").find((file) =>
      file.endsWith("css-syntax-error.js"),
    );
    assert.ok(relative !== undefined, "postcss ships the file this case reads");
    assert.equal(
      readInstalledFile("postcss", relative),
      readFileSync(installedPackagePath("postcss", relative), "utf8"),
    );
  });
});

describe("installedBin", () => {
  it("points at npm's shim directory rather than at a package", () => {
    assert.equal(installedBin("tsc"), path.join(REPO_ROOT, "node_modules", ".bin", "tsc"));
    assert.ok(existsSync(installedBin("tsc")), "tsc's shim is what the typecheck fixture executes");
  });
});

/**
 * The rule: a suite reaches the installed tree through the helper.
 *
 * The shape is the CONJUNCTION of joining onto the repository root and naming
 * `node_modules` as the first segment. That matters because half a dozen
 * suites mention the directory for reasons that are not this: `git-io.test.ts`
 * and `secret-scan.test.ts` pass it in `skipDirs` so a walk does NOT enter it,
 * `guard-fixture-refusals.test.ts` builds fake resolution chains under
 * `mkdtemp`, and `check-sentry-version.test.ts` reads `node_modules/...` as a
 * KEY in package-lock.json. Banning the word would have taken ten exemptions,
 * which is a list rather than a rule.
 */
describe("no suite reaches into node_modules by hand", () => {
  const BY_HAND = /(?:repoPath|path\.join)\(\s*(?:REPO_ROOT\s*,\s*)?["']node_modules["']/;

  /**
   * The two suites that WRITE the shape without performing it.
   *
   * Both plant it as a fixture string to prove their own sweep is not vacuous
   * — `lint-guard-premise.test.ts` for the tsx-bin spawn it forbids, and this
   * file for the rule right here. A pattern that cannot be demonstrated firing
   * is one nobody can trust, so the exemption is not a hole in the rule; it is
   * the only way the rule gets shown to work.
   */
  const PLANTS_THE_SHAPE: readonly string[] = [
    "installed-packages-helper.test.ts",
    "lint-guard-premise.test.ts",
  ];

  it("nothing joins node_modules onto the repository root itself", () => {
    // Through `suiteCode`, so the doc comment above may quote the shape.
    const offenders = suiteFiles().filter(
      (relative) => !PLANTS_THE_SHAPE.includes(relative) && BY_HAND.test(suiteCode(relative)),
    );
    assert.deepEqual(
      offenders,
      [],
      `these suites read the installed tree directly — use __tests__/helpers/installed-packages.ts, which is also where the reason this read is different from every other read here is written down:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("fires on the shape it bans, in both spellings", () => {
    // A pattern that matched nothing would report a clean tree forever, which
    // is exactly the state the rule was written to leave behind.
    for (const planted of [
      'const root = repoPath("node_modules", pkg);',
      'execFileSync(path.join(REPO_ROOT, "node_modules", ".bin", "tsc"), args);',
    ]) {
      assert.ok(BY_HAND.test(planted), `the rule does not fire on: ${planted}`);
    }
  });

  it("leaves the reasons that are not a read alone", () => {
    // The other half of anti-vacuous: a rule this narrow is only worth having
    // if it stays silent on the four shapes that made the wide one impossible.
    for (const allowed of [
      'listFilesUnder(REPO_ROOT, { skipDirs: ["dist", "node_modules"] });',
      'fs.mkdirSync(path.join(root, "node_modules", "tsx"), { recursive: true });',
      'lock.packages["node_modules/@sentry/react-native"].version;',
      'write(root, "lib/node_modules/dep/index.js", NEW);',
    ]) {
      assert.ok(!BY_HAND.test(allowed), `the rule fires on something that is not a read: ${allowed}`);
    }
  });

  it("keeps both exemptions to files that still plant the shape", () => {
    assertExemptionsHonest({
      exemptions: PLANTS_THE_SHAPE,
      expected: ["installed-packages-helper.test.ts", "lint-guard-premise.test.ts"],
      rule: "the by-hand node_modules rule",
      stillNeeded: (relative) => BY_HAND.test(suiteCode(relative)),
    });
  });

  it("still sweeps the suites rather than an empty list", () => {
    assert.ok(
      suiteFiles().length >= 100,
      `only ${String(suiteFiles().length)} suites walked — a broken walk agrees with every rule it cannot read`,
    );
  });
});
