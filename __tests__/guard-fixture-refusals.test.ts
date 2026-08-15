/**
 * The guard fixture's OWN refusals, each given a run.
 *
 * `__tests__/helpers/guard-fixture.ts` is the floor under five suites and a
 * few hundred assertions, and almost every claim those suites make is really a
 * claim about it: that the scratch root holds what the spec asked for, that
 * the patched copy is the thing that ran, that the patch landed. It defends
 * each of those with a throw — nine of them — and until this file none of the
 * throws had ever been seen to fire.
 *
 * That is the worst shape for a safety net. A guard that cannot fire is
 * indistinguishable from one that fires correctly, right up to the day the
 * thing it was watching for happens: `makeSharedPatchedRepo`'s marker check is
 * the single thing standing between thirteen provenance assertions and being
 * vacuous, and `entryPatch`'s brace counter is the single thing standing
 * between a patched table and a rewrite that landed in the wrong half.
 *
 * So: the bad spec, the missing key, the drifted anchor, the entry that never
 * closes — one case each, asserting the sentence and, where the fixture makes
 * one, the promise that comes with it (the scratch directory is taken back
 * down; the copy is restored).
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { LINT_GUARDS } from "../lib/lint-guards";
import {
  assertNoStackTrace,
  checkNameOf,
  entryPatch,
  makePartialRoot,
  makeSharedPatchedRepo,
  PATCHED_REPO_MARKER,
  tsxLoaderIn,
} from "./helpers/guard-fixture";

const REPO_ROOT = path.resolve(__dirname, "..");
const FLOOR_MODULE = "lib/scanned-floor.ts";

/**
 * Names of the scratch roots the fixture has open right now.
 *
 * Every refusal in `makePartialRoot` happens after `mkdtempSync`, so "it threw
 * the right sentence" is only half the claim — the other half is that the
 * directory it had already created is gone. Comparing the set before and after
 * is the only way to see that from outside: the function throws instead of
 * returning, so the path it would have cleaned up is never handed back.
 */
function scratchRoots(): Set<string> {
  return new Set(
    fs
      .readdirSync(os.tmpdir())
      .filter((entry) => entry.startsWith("lint-guard-partial-")),
  );
}

/** Runs `body`, expecting a throw, and reports any scratch root it left behind. */
function assertRefusesWithoutLeaking(body: () => unknown, message: RegExp): void {
  const before = scratchRoots();
  assert.throws(body, message);
  const leaked = [...scratchRoots()].filter((entry) => !before.has(entry));
  assert.deepEqual(
    leaked,
    [],
    `the refusal left ${leaked.length} scratch root(s) in ${os.tmpdir()}: ${leaked.join(", ")}`,
  );
}

describe("the loader check", () => {
  /**
   * A scratch checkout, `body` run against it, and the directory taken back
   * down afterwards.
   *
   * Every case here needs a root that is NOT this repository, and two of them
   * need to plant files under it, so the mkdtemp/rmSync pair is worth one
   * helper rather than three `finally` blocks.
   */
  function inScratchCheckout(body: (root: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "no-install-"));
    try {
      body(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  /** The fixture's refusal for `root`, or a failure saying it did not refuse. */
  function refusalFor(root: string): string {
    let loader: string | undefined;
    try {
      loader = tsxLoaderIn(root);
    } catch (error) {
      return (error as Error).message;
    }
    assert.fail(
      `tsxLoaderIn answered "${loader}" for ${root}, which has no loadable tsx — a guard spawned against it exits 1 with both pipes empty, the one failure this check exists to tell apart from a refusal.`,
    );
  }

  it("refuses a checkout with no install, and says how to fix it", () => {
    // The refusal with the strongest claim on a run: an absent loader exits
    // non-zero with BOTH pipes empty, which is byte-for-byte what a guard
    // refusing looks like to these suites. Without this check every "the run
    // failed" assertion in five files would pass for the wrong reason. It fired
    // for real on the checkout this case was written on, which is exactly why
    // its wording — the path, and `npm ci` — should be pinned rather than
    // rediscovered by whoever next forgets to install.
    inScratchCheckout((bare) => {
      const message = refusalFor(bare);
      assert.match(message, /does not resolve from .+, so no guard can be spawned/s);
      assert.match(message, /npm ci/);
      assert.ok(
        message.includes(bare),
        `the diagnosis does not name the checkout it looked in:\n${message}`,
      );
      assert.ok(
        message.includes(path.join(bare, "node_modules")),
        `the diagnosis does not name the directory it looked under:\n${message}`,
      );
    });
  });

  it("refuses a half-written install, where the directory is there and the package is not", () => {
    // The case the `existsSync` this replaced could not see, and the reason it
    // was replaced: an interrupted `npm ci` leaves `node_modules/tsx` behind
    // with nothing loadable in it. A path check calls that an install and hands
    // the suites a loader specifier that resolves to nothing, which is the
    // empty-pipes failure the check exists to prevent, arriving through the
    // check itself.
    inScratchCheckout((root) => {
      fs.mkdirSync(path.join(root, "node_modules", "tsx"), { recursive: true });
      const message = refusalFor(root);
      assert.match(message, /npm ci/);
      assert.ok(
        message.includes(root),
        `the diagnosis does not name the checkout it looked in:\n${message}`,
      );
    });
  });

  it("refuses a package whose declared entry point is missing", () => {
    // The other half of a half-written install, and the one a `package.json`
    // check would also wave through: the manifest is there, well-formed and
    // pointing at a file the store never finished writing. Only asking the
    // resolver catches it.
    inScratchCheckout((root) => {
      const pkg = path.join(root, "node_modules", "tsx");
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(
        path.join(pkg, "package.json"),
        JSON.stringify({ name: "tsx", version: "0.0.0", main: "dist/loader.mjs" }),
      );
      const message = refusalFor(root);
      assert.match(message, /npm ci/);
    });
  });

  it("names the resolver's own reason, so the two broken installs read differently", () => {
    // A half-written install and an absent one want different fixes, and the
    // sentence is the only place the reader can tell them apart — the tail
    // ("run `npm ci`") is identical by design.
    inScratchCheckout((absent) => {
      inScratchCheckout((half) => {
        fs.mkdirSync(path.join(half, "node_modules", "tsx"), { recursive: true });
        const missing = refusalFor(absent);
        const broken = refusalFor(half);
        for (const message of [missing, broken]) {
          assert.match(
            message,
            /Cannot find module/,
            `the diagnosis drops the resolver's own reason:\n${message}`,
          );
        }
        assert.notEqual(
          missing.replace(absent, "<root>"),
          broken.replace(half, "<root>"),
          "an absent install and a half-written one produce the same sentence, so the message says nothing the root did not already say",
        );
      });
    });
  });

  it("answers with the bare specifier, not the file the resolver named", () => {
    // `--import /abs/node_modules/tsx` is an ERR_UNSUPPORTED_DIR_IMPORT, and
    // the CJS resolution may name a different entry than the `import`
    // condition the spawn gets; the bare name resolves through the package's
    // own exports map either way.
    assert.equal(tsxLoaderIn(REPO_ROOT), "tsx");
  });
});

describe("makePartialRoot refusals", () => {
  // The two specs that carry no copies at all — `([], {})` and an absolute
  // literal key — are asserted next door in `lint-guard-empty-input.test.ts`,
  // in the suite whose fixtures write literals. These are the two about
  // COPIES, which that suite does not make.

  it("refuses an absolute entry, which would copy from outside this checkout", () => {
    assertRefusesWithoutLeaking(
      () => makePartialRoot([path.join(REPO_ROOT, "lib")]),
      /must be repo-relative/,
    );
  });

  it("refuses an entry this repository does not have", () => {
    // The reason this is a refusal rather than a shrug: `cpSync` of a missing
    // source would leave the root empty, every guard pointed at it would fail
    // on `no_files`, and a `below_floor` fixture would assert the wrong code
    // while looking like it worked.
    assertRefusesWithoutLeaking(
      () => makePartialRoot(["lib/there-is-no-such-module.ts"]),
      /does not exist in this repository/,
    );
  });

  it("takes the scratch root back down when a later entry is the bad one", () => {
    // The first entry copies fine, so the directory is not just created but
    // populated before the refusal — the case the plain `rmSync` would miss if
    // it were not recursive.
    assertRefusesWithoutLeaking(
      () => makePartialRoot(["lib/lint-guards.ts", "lib/no-such-file.ts"]),
      /does not exist in this repository/,
    );
  });

  it("builds what it was asked for and nothing else", () => {
    const fixture = makePartialRoot(["lib/lint-guards.ts"], {
      "app/blank.json": "{}",
    });
    try {
      assert.ok(fs.existsSync(path.join(fixture.root, "lib/lint-guards.ts")));
      assert.equal(
        fs.readFileSync(path.join(fixture.root, "app/blank.json"), "utf8"),
        "{}",
      );
      assert.deepEqual(fs.readdirSync(fixture.root).sort(), ["app", "lib"]);
      // Real directories, not a flat file named "lib/lint-guards.ts": a top
      // level walk has to be able to descend into them.
      assert.ok(fs.statSync(path.join(fixture.root, "lib")).isDirectory());
    } finally {
      fixture.cleanup();
    }
    assert.equal(fs.existsSync(fixture.root), false, "cleanup left the root behind");
  });
});

describe("makeSharedPatchedRepo refusals", () => {
  it("refuses a copy the marker cannot be injected into", () => {
    // `scripts/` alone runs a guard perfectly well — the wrapper is there, its
    // imports are not — so this fails at the marker rather than at the spawn,
    // and it has to: without the marker every provenance assertion in the two
    // patched-table suites would pass by saying nothing.
    assertRefusesWithoutLeaking(
      () => makeSharedPatchedRepo(["scripts"]),
      /is not in the copied entries/,
    );
  });
});

describe("the shared patched copy", () => {
  const repo = makeSharedPatchedRepo();
  after(() => repo.cleanup());

  const markerTarget = path.join(repo.root, FLOOR_MODULE);
  const guard = LINT_GUARDS.find(
    (entry) => checkNameOf(entry.scriptPath) === "check-inline-hex",
  );
  assert.ok(guard, "check-inline-hex is not in LINT_GUARDS");

  it("injects the marker at the top of the module every wrapper imports", () => {
    const [firstLine] = fs.readFileSync(markerTarget, "utf8").split("\n");
    assert.equal(firstLine, `console.error(${JSON.stringify(PATCHED_REPO_MARKER)});`);
    // The sentence the real checkout cannot say — which is the whole point.
    assert.doesNotMatch(
      fs.readFileSync(path.join(REPO_ROOT, FLOOR_MODULE), "utf8"),
      new RegExp(PATCHED_REPO_MARKER),
    );
  });

  it("refuses a patch aimed at a file the copy does not hold", () => {
    assert.throws(
      () =>
        repo.runPatched(
          "absent-file",
          { "app/index.tsx": (source) => `${source}\n` },
          guard,
          REPO_ROOT,
        ),
      /would land nowhere/,
    );
  });

  it("refuses a patch that changed nothing", () => {
    // The anchor has drifted: the fixture would spawn an UNPATCHED guard and
    // the case would report whatever the committed table does, under a name
    // claiming a broken one.
    assert.throws(
      () =>
        repo.runPatched("no-op", { [FLOOR_MODULE]: (source) => source }, guard, REPO_ROOT),
      /changed nothing/,
    );
  });

  it("restores the files a refused multi-file patch had already rewritten", () => {
    // `applyPatches` writes entry by entry, so a second patch whose anchor has
    // drifted throws with the FIRST file already on disk. If that throw escaped
    // before the restore, the next case would run against a copy carrying an
    // edit its own patch never mentions — a failure attributed to the wrong
    // declaration entirely.
    const before = fs.readFileSync(markerTarget, "utf8");
    assert.throws(
      () =>
        repo.runPatched(
          "partial-apply",
          {
            [FLOOR_MODULE]: (source) => `// touched\n${source}`,
            "lib/lint-guards.ts": (source) => source,
          },
          guard,
          REPO_ROOT,
        ),
      /changed nothing/,
    );
    assert.equal(
      fs.readFileSync(markerTarget, "utf8"),
      before,
      "the first file of a refused patch stayed rewritten",
    );
  });

  it("restores the copy after a run that really spawned", () => {
    const before = fs.readFileSync(markerTarget, "utf8");
    const scan = makePartialRoot(["lib/lint-guards.ts"]);
    try {
      const run = repo.runPatched(
        "restored",
        { [FLOOR_MODULE]: (source) => `// a comment the guard never reads\n${source}` },
        guard,
        scan.root,
      );
      assert.match(
        run.output,
        new RegExp(PATCHED_REPO_MARKER),
        `the run did not come out of the patched copy:\n${run.output}`,
      );
      assertNoStackTrace(run.output, "restored-copy run");
    } finally {
      scan.cleanup();
    }
    assert.equal(
      fs.readFileSync(markerTarget, "utf8"),
      before,
      "the patch outlived the run it was made for",
    );
  });
});

describe("entryPatch refusals", () => {
  /** A table with the two shapes the parser has to tell apart. */
  const TABLE = [
    "export const SCANNED_FLOORS = {",
    '  "check-flat": {',
    "    minimum: 160,",
    '    label: "files",',
    "  },",
    '  "check-nested": {',
    "    count: { minimum: 12 },",
    '    label: "files",',
    "  },",
    "} as const;",
    "",
  ].join("\n");

  it("refuses a key the table does not declare", () => {
    assert.throws(
      () => entryPatch("check-renamed-away", (entry) => entry)(TABLE),
      /has no entry in/,
    );
  });

  it("refuses an entry that never closes", () => {
    assert.throws(
      () => entryPatch("check-flat", (entry) => entry)('  "check-flat": {\n    minimum: 1,\n'),
      /never closes/,
    );
  });

  it("refuses a rewrite that matched nothing in the entry", () => {
    assert.throws(
      () => entryPatch("check-flat", (entry) => entry.replace(/minimum: 999/, "minimum: 1"))(TABLE),
      /matched nothing/,
    );
  });

  it("rewrites inside the named entry and leaves its neighbour alone", () => {
    const patched = entryPatch("check-flat", (entry) =>
      entry.replace(/minimum: 160/, "minimum: 1"),
    )(TABLE);
    assert.match(patched, /"check-flat": \{\n    minimum: 1,/);
    assert.match(patched, /"check-nested": \{\n    count: \{ minimum: 12 \},/);
  });

  it("slices a NESTED entry whole rather than stopping at its inner brace", () => {
    // The reason the parser counts braces instead of scanning for the first
    // `\n  },`: an entry that nests would end the slice early, the rewrite
    // would land in the half after it, and `runPatched`'s no-op check would
    // wave it through because the patch did change something.
    const patched = entryPatch("check-nested", (entry) =>
      entry.replace(/label: "files"/, 'label: "declared inputs"'),
    )(TABLE);
    assert.match(patched, /"check-nested": \{\n    count: \{ minimum: 12 \},\n    label: "declared inputs",/);
    assert.match(patched, /"check-flat": \{\n    minimum: 160,\n    label: "files",/);
  });

  it("reads the committed table, not just the fixture's idea of one", () => {
    // The cases above pin the parser; this pins the assumption it rests on —
    // that a real `SCANNED_FLOORS` entry is shaped the way they say.
    const source = fs.readFileSync(path.join(REPO_ROOT, FLOOR_MODULE), "utf8");
    const patched = entryPatch("check-inline-hex", (entry) =>
      entry.replace(/minimum: \d+/, "minimum: 999999"),
    )(source);
    assert.match(patched, /"check-inline-hex": \{[\s\S]*?minimum: 999999/);
    assert.equal(
      patched.match(/minimum: 999999/g)?.length,
      1,
      "the rewrite escaped the entry it named",
    );
  });
});

describe("assertNoStackTrace", () => {
  it("accepts a refusal that is prose, including prose containing the word at", () => {
    assertNoStackTrace("check-inline-hex: 3 files at fault, none of them read.");
  });

  it("catches a frame on the first line, where a bare /\\n\\s+at/ would not", () => {
    assert.throws(
      () => assertNoStackTrace("    at scannedFloorFor (/repo/lib/scanned-floor.ts:12:9)"),
      /crashed rather than refusing/,
    );
  });

  it("catches the bare frame shape V8 emits without a function name", () => {
    assert.throws(
      () => assertNoStackTrace("Error: nope\n    at /repo/scripts/check-inline-hex.ts:4:1"),
      /crashed rather than refusing/,
    );
  });

  it("names the run in the message when given a context", () => {
    assert.throws(
      () => assertNoStackTrace("    at x (/a.ts:1:1)", "no_files case"),
      /no_files case: crashed rather than refusing/,
    );
  });
});

describe("checkNameOf", () => {
  it("is the name every guard prints at the head of its own report", () => {
    assert.equal(checkNameOf("scripts/check-inline-hex.ts"), "check-inline-hex");
  });

  it("agrees with every committed wrapper path", () => {
    for (const guard of LINT_GUARDS) {
      const name = checkNameOf(guard.scriptPath);
      assert.doesNotMatch(name, /[/.]/, `${guard.scriptPath} keeps a path part in its check name`);
      assert.equal(`scripts/${name}.ts`, guard.scriptPath);
    }
  });
});
