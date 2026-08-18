import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  BUNDLE_SOURCE_PATHS,
  WEB_BUNDLE_DIR,
  WEB_BUNDLE_DIR_SEGMENTS,
  evaluateBundlePremise,
  evaluateScannedFiles,
  formatBundlePremiseFailure,
  type BundlePremiseFailureCode,
  type BundlePremiseInput,
} from "../lib/bundle-premise";
import { collectBundlePremise } from "../scripts/bundle-premise";
import { readRepoFile as read, repoPath } from "./helpers/repo-file";

/**
 * Pins the shared "the input exists and is fresh" premise the three
 * post-build guards now assert before they check anything.
 *
 * All three prove a NEGATIVE over `dist/` — no leaked secret, no blown
 * budget, no un-inlined env var — and a guard that proves a negative reports
 * success when it has no input at all. `check-bundle-secrets` did exactly
 * that: it verified `dist/` existed as a directory and then printed
 * `scanned 0 bundle file(s), no secrets leaked` if the walk matched nothing.
 * The second, quieter route to the same green is a STALE `dist/`: a bundle
 * exported before the change being checked existed.
 *
 * Same vacuous-green shape as the `sentry-sdk-absent` job's `rm -rf` (exit 0
 * whether or not there was anything to delete) and the Node 20 outage
 * (coverage evaporated while the report stayed small and green).
 *
 * The fixture block below drives the REAL collector against temp directories
 * rather than hand-building `BundlePremiseInput` literals, because the half
 * most likely to rot is the walk — an exclusion list that stops excluding
 * `scripts/` would make every guard fail on an unrelated edit, and a literal
 * would never notice.
 */

/** Drops block and line comments so a source scan reads executable code only. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FRESH: BundlePremiseInput = {
  distExists: true,
  bundleDirExists: true,
  jsBundleCount: 2,
  newestBundleMtimeMs: 2_000,
  newestSourceMtimeMs: 1_000,
  newestSourcePath: "app/index.tsx",
};

const ALL_CODES: BundlePremiseFailureCode[] = [
  "missing_dist",
  "missing_bundle_dir",
  "no_js_bundles",
  "no_scanned_files",
  "stale_bundle",
];

describe("evaluateBundlePremise", () => {
  it("passes a bundle that exists and is newer than the source tree", () => {
    assert.deepEqual(evaluateBundlePremise(FRESH), { ok: true });
  });

  it("passes when the newest source and the bundle share an mtime", () => {
    // A source file written in the same millisecond the export finished is
    // not evidence of a stale bundle; only STRICTLY newer is.
    const verdict = evaluateBundlePremise({
      ...FRESH,
      newestSourceMtimeMs: FRESH.newestBundleMtimeMs,
    });
    assert.deepEqual(verdict, { ok: true });
  });

  it("fails with missing_dist when there is no dist/", () => {
    const verdict = evaluateBundlePremise({ ...FRESH, distExists: false });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false && verdict.failure.code, "missing_dist");
  });

  it("fails with missing_bundle_dir when dist/ has no exported web chunks dir", () => {
    const verdict = evaluateBundlePremise({ ...FRESH, bundleDirExists: false });
    assert.equal(verdict.ok === false && verdict.failure.code, "missing_bundle_dir");
  });

  it("fails with no_js_bundles when the chunk glob matched nothing", () => {
    const verdict = evaluateBundlePremise({ ...FRESH, jsBundleCount: 0 });
    assert.equal(verdict.ok === false && verdict.failure.code, "no_js_bundles");
  });

  it("fails with stale_bundle and names the offending source file", () => {
    const verdict = evaluateBundlePremise({
      ...FRESH,
      newestSourceMtimeMs: 5_000,
      newestSourcePath: "lib/supabase.ts",
    });
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.failure.code, "stale_bundle");
    assert.equal(verdict.failure.sourcePath, "lib/supabase.ts");
    assert.equal(verdict.failure.staleByMs, 3_000);
  });

  it("reports the most specific cause first — a missing dist/ is not 'stale'", () => {
    // A tree that was never built is also, technically, older than its
    // sources. Reporting staleness there sends the reader looking for a
    // rebuild loop rather than a missing build.
    const verdict = evaluateBundlePremise({
      ...FRESH,
      distExists: false,
      newestSourceMtimeMs: 9_999,
    });
    assert.equal(verdict.ok === false && verdict.failure.code, "missing_dist");
  });

  it("skips the staleness comparison when either mtime is unknown", () => {
    // A collector that could not stat the tree must not be able to fail the
    // build with a comparison it never actually made.
    assert.deepEqual(
      evaluateBundlePremise({ ...FRESH, newestSourceMtimeMs: null, newestSourcePath: null }),
      { ok: true },
    );
    assert.deepEqual(
      evaluateBundlePremise({ ...FRESH, newestBundleMtimeMs: null, newestSourceMtimeMs: 9_999 }),
      { ok: true },
    );
  });
});

describe("evaluateScannedFiles", () => {
  it("passes a non-empty scan", () => {
    assert.deepEqual(evaluateScannedFiles(1, "bundle file"), { ok: true });
  });

  it("fails an empty scan and carries the caller's label", () => {
    const verdict = evaluateScannedFiles(0, "bundle file");
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.failure.code, "no_scanned_files");
    assert.equal(verdict.failure.scannedLabel, "bundle file");
  });

  it("treats a negative count as empty rather than passing it through", () => {
    assert.equal(evaluateScannedFiles(-1, "bundle file").ok, false);
  });
});

describe("formatBundlePremiseFailure", () => {
  it("has a distinct, non-empty message for every failure code", () => {
    const messages = ALL_CODES.map((code) =>
      formatBundlePremiseFailure("check-x", { code }),
    );
    for (const [i, message] of messages.entries()) {
      assert.ok(message.length > 20, `${ALL_CODES[i]} needs a real message`);
    }
    assert.equal(
      new Set(messages).size,
      ALL_CODES.length,
      "two codes sharing a message would make the log ambiguous about which premise broke",
    );
  });

  it("names the failing guard and tells the reader how to fix it", () => {
    for (const code of ALL_CODES) {
      const message = formatBundlePremiseFailure("check-bundle-size", { code });
      assert.match(message, /^check-bundle-size: ERROR — /);
      assert.match(
        message,
        /npm run build/,
        `${code} must point at the rebuild — every one of these is fixed the same way`,
      );
    }
  });

  it("spells out the stale case with the file and how far behind the bundle is", () => {
    const message = formatBundlePremiseFailure("check-bundle-secrets", {
      code: "stale_bundle",
      sourcePath: "app/create.tsx",
      staleByMs: 42_000,
    });
    assert.match(message, /app\/create\.tsx/);
    assert.match(message, /42s/);
  });

  it("names what was scanned in the empty-scan case", () => {
    const message = formatBundlePremiseFailure("check-bundle-secrets", {
      code: "no_scanned_files",
      scannedLabel: "bundle file",
    });
    assert.match(message, /bundle file/);
    assert.match(message, /zero files/);
  });
});

describe("the declared bundle input", () => {
  it("resolves to the directory the export writes", () => {
    assert.equal(WEB_BUNDLE_DIR, "dist/_expo/static/js/web");
    assert.equal(WEB_BUNDLE_DIR_SEGMENTS[0], "dist");
  });

  it("is the ONLY definition of the glob — no workflow hand-rolls it", () => {
    // ci.yml used to `ls dist/_expo/static/js/web/*.js | head -1` inside the
    // bundle smoke step: a second definition of the input that could drift
    // from the guards' and, being shell, checked neither freshness nor the
    // chunks past the first. That step is now `npm run lint:bundle-smoke`,
    // which takes its chunk list from assertBundlePremise like the other
    // three. Fail if the glob reappears in YAML.
    for (const workflow of fs.readdirSync(
      repoPath(".github", "workflows"),
    )) {
      if (!workflow.endsWith(".yml") && !workflow.endsWith(".yaml")) continue;
      const body = read(path.join(".github", "workflows", workflow));
      assert.ok(
        !body.includes(`${WEB_BUNDLE_DIR}/*.js`),
        `${workflow} globs the bundle directory itself — route it through assertBundlePremise instead`,
      );
    }
  });

  it("covers the directories Metro actually bundles", () => {
    for (const required of ["app", "components", "lib", "assets"]) {
      assert.ok(
        (BUNDLE_SOURCE_PATHS as readonly string[]).includes(required),
        `${required}/ ends up in the bundle, so editing it invalidates dist/`,
      );
    }
  });

  it("excludes the trees Metro never bundles", () => {
    // A test or a lint guard changing must not make a perfectly current
    // bundle look stale — a freshness check that cries wolf gets turned off.
    for (const excluded of ["__tests__", "scripts", "dist", ".github"]) {
      assert.ok(
        !(BUNDLE_SOURCE_PATHS as readonly string[]).includes(excluded),
        `${excluded}/ is not bundled; listing it would produce false staleness`,
      );
    }
  });
});

describe("collectBundlePremise against a real tree", () => {
  const fixtures: string[] = [];

  const makeRoot = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-premise-"));
    fixtures.push(dir);
    return dir;
  };

  /** Writes `rel` under `root` with an explicit mtime, creating parents. */
  const write = (root: string, rel: string, mtimeSeconds: number): string => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "// fixture\n");
    fs.utimesSync(full, mtimeSeconds, mtimeSeconds);
    return full;
  };

  const OLD = 1_600_000_000;
  const NEW = 1_700_000_000;

  it("reports missing_dist for a tree that was never built", () => {
    const root = makeRoot();
    write(root, "app/index.tsx", OLD);
    const verdict = evaluateBundlePremise(collectBundlePremise(root));
    assert.equal(verdict.ok === false && verdict.failure.code, "missing_dist");
  });

  it("reports missing_bundle_dir for a dist/ without the web chunk directory", () => {
    const root = makeRoot();
    write(root, "app/index.tsx", OLD);
    write(root, "dist/index.html", NEW);
    const verdict = evaluateBundlePremise(collectBundlePremise(root));
    assert.equal(
      verdict.ok === false && verdict.failure.code,
      "missing_bundle_dir",
    );
  });

  it("reports no_js_bundles when only sourcemaps survived", () => {
    const root = makeRoot();
    write(root, "app/index.tsx", OLD);
    write(root, `${WEB_BUNDLE_DIR}/entry.js.map`, NEW);
    const collected = collectBundlePremise(root);
    assert.equal(collected.jsBundleCount, 0);
    const verdict = evaluateBundlePremise(collected);
    assert.equal(verdict.ok === false && verdict.failure.code, "no_js_bundles");
  });

  it("passes a fresh bundle and hands back its chunks", () => {
    const root = makeRoot();
    write(root, "app/index.tsx", OLD);
    write(root, "lib/supabase.ts", OLD);
    const chunk = write(root, `${WEB_BUNDLE_DIR}/entry-abc.js`, NEW);
    const collected = collectBundlePremise(root);
    assert.deepEqual([...collected.jsBundlePaths], [chunk]);
    assert.deepEqual(evaluateBundlePremise(collected), { ok: true });
  });

  it("reports stale_bundle when a bundled source is newer than the export", () => {
    const root = makeRoot();
    write(root, `${WEB_BUNDLE_DIR}/entry-abc.js`, OLD);
    write(root, "components/item-filters.tsx", NEW);
    const verdict = evaluateBundlePremise(collectBundlePremise(root));
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.equal(verdict.failure.code, "stale_bundle");
    assert.equal(
      verdict.failure.sourcePath,
      path.join("components", "item-filters.tsx"),
    );
  });

  it("does not call a bundle stale because a test or a script changed", () => {
    // The whole exclusion list, exercised rather than declared: these are the
    // files edited most often in this repo and none of them reaches Metro.
    const root = makeRoot();
    write(root, "app/index.tsx", OLD);
    write(root, `${WEB_BUNDLE_DIR}/entry-abc.js`, OLD + 10);
    write(root, "__tests__/some.test.ts", NEW);
    write(root, "scripts/check-something.ts", NEW);
    write(root, ".github/workflows/ci.yml", NEW);
    assert.deepEqual(evaluateBundlePremise(collectBundlePremise(root)), {
      ok: true,
    });
  });

  it("skips node_modules nested inside a bundled directory", () => {
    // A hoisted dependency under lib/ would otherwise dominate the newest
    // mtime after every `npm ci` and fail every guard on a clean checkout.
    const root = makeRoot();
    write(root, "lib/supabase.ts", OLD);
    write(root, "lib/node_modules/dep/index.js", NEW);
    write(root, `${WEB_BUNDLE_DIR}/entry-abc.js`, OLD + 10);
    assert.deepEqual(evaluateBundlePremise(collectBundlePremise(root)), {
      ok: true,
    });
  });

  it("tolerates a source path that does not exist in the tree", () => {
    // BUNDLE_SOURCE_PATHS names optional config files (babel/metro); a
    // missing one must be skipped, not counted as a premise failure.
    const root = makeRoot();
    write(root, `${WEB_BUNDLE_DIR}/entry-abc.js`, NEW);
    const collected = collectBundlePremise(root);
    assert.equal(collected.newestSourceMtimeMs, null);
    assert.deepEqual(evaluateBundlePremise(collected), { ok: true });
  });

  it("agrees with the real repo checkout on the source side", () => {
    // Vacuity guard for the block above: if the collector silently walked
    // nothing, every fixture assertion would still pass.
    const collected = collectBundlePremise();
    assert.ok(
      collected.newestSourceMtimeMs !== null && collected.newestSourcePath !== null,
      "the collector must find the repo's own bundled sources",
    );
  });

  process.on("exit", () => {
    for (const dir of fixtures) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; a leftover temp dir must not fail the suite.
      }
    }
  });
});

describe("every post-build guard asserts the premise", () => {
  const GUARDS = [
    "scripts/check-bundle-secrets.ts",
    "scripts/check-bundle-size.ts",
    "scripts/verify-bundle-inlining.ts",
  ];

  for (const guard of GUARDS) {
    describe(guard, () => {
      const source = read(guard);

      it("imports the shared premise instead of re-deriving it", () => {
        assert.match(
          source,
          /import \{[^}]*assertBundlePremise[^}]*\} from "\.\/bundle-premise"/,
          `${guard} must use the shared premise so all three agree on what "there is a bundle" means`,
        );
      });

      it("calls assertBundlePremise before doing its own work", () => {
        const call = source.indexOf("assertBundlePremise(CHECK_NAME");
        assert.ok(call > 0, `${guard} must actually call the assertion`);
        const mainStart = source.indexOf("function main()");
        assert.ok(
          mainStart > 0 && call > mainStart,
          `${guard} must assert inside main(), before it reads the bundle`,
        );
      });

      it("does not keep its own copy of the chunk glob", () => {
        // Three hand-written `readdirSync(BUNDLE_DIR).filter(.js)` copies is
        // how one of them ends up matching something the others do not.
        // Comments are allowed to name the directory while explaining it;
        // only executable lines count as a second copy.
        const code = stripComments(source);
        assert.doesNotMatch(
          code,
          /"_expo"|_expo\/static/,
          `${guard} must take the bundle path from WEB_BUNDLE_DIR_SEGMENTS`,
        );
        assert.doesNotMatch(
          code,
          /readdirSync\(BUNDLE_DIR\)/,
          `${guard} must take its chunk list from assertBundlePremise`,
        );
      });
    });
  }

  it("makes check-bundle-secrets assert its own scan is non-empty", () => {
    const source = read("scripts/check-bundle-secrets.ts");
    const assertion = source.indexOf("assertScannedFiles(");
    const successBranch = source.indexOf("matches.length === 0");
    assert.ok(assertion > 0, "the empty-scan assertion must exist");
    assert.ok(
      successBranch > 0 && assertion < successBranch,
      "the scan must be proven non-empty BEFORE `no secrets leaked` can be printed",
    );
  });

  it("no longer lets dist/ existing stand in for dist/ having content", () => {
    const source = read("scripts/check-bundle-secrets.ts");
    assert.doesNotMatch(
      source,
      /if \(!fs\.existsSync\(DIST_DIR\)\)/,
      "a bare existsSync passes over an empty dist/ — that was the original bug",
    );
  });

  it("keeps lib/bundle-premise.ts pure so Metro can still bundle lib/", () => {
    const source = read("lib/bundle-premise.ts");
    assert.doesNotMatch(
      source,
      /from "node:/,
      "lib/ is bundled for web; the filesystem half belongs in scripts/bundle-premise.ts",
    );
  });
});
