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
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { LINT_GUARDS } from "../lib/lint-guards";
import {
  assertNoStackTrace,
  checkNameOf,
  describeResolveFailure,
  entryPatch,
  makePartialRoot,
  makeSharedPatchedRepo,
  PATCHED_REPO_MARKER,
  tsxLoaderIn,
} from "./helpers/guard-fixture";

const REPO_ROOT = path.resolve(__dirname, "..");
const FLOOR_MODULE = "lib/scanned-floor.ts";

/**
 * The opening sentence of a refusal — up to and including the first period
 * that ends a word rather than sitting inside a path or a filename.
 *
 * Every refusal here is a paragraph: a finding, then what it is not, then what
 * to do about it. The finding is the first sentence, and it is the part that
 * gets read, quoted into an issue and searched for, so it is the part two
 * messages must not share. A period followed by whitespace (or the end) is the
 * boundary; `index.js` and `~/.node_modules` appear in these messages and are
 * not sentence ends.
 */
function leadingSentence(message: string): string {
  const match = /^[\s\S]*?\.(?=\s|$)/.exec(message);
  return match ? match[0] : message;
}

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

  /**
   * A loadable package named `tsx` inside `dir`, for a `NODE_PATH` that has to
   * answer.
   *
   * Four cases need one and each used to spell it out — `mkdirSync`, a
   * manifest, an `index.js` — which says how a package is shaped four times
   * over and what the case is testing nowhere. Loadable rather than empty on
   * purpose: an empty directory is skipped by the resolver, so the global
   * folder would not answer and the case would assert the absent-install
   * refusal while looking like it tested a global one.
   */
  function plantGlobalTsx(dir: string): void {
    const pkg = path.join(dir, "tsx");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "tsx", version: "0.0.0", main: "index.js" }),
    );
    fs.writeFileSync(path.join(pkg, "index.js"), "module.exports = {};\n");
  }

  /**
   * `tsxLoaderIn(root)` run in a fresh node process carrying `env`, reported as
   * `"ANSWERED <specifier>"` or `"REFUSED <message>"`.
   *
   * A child rather than a call because the environment that matters here —
   * `NODE_PATH` — is read once, when node builds its global module paths at
   * startup; assigning it in this process changes nothing about how this
   * process resolves. `--import tsx` so the child can require the helper's TS,
   * the same loader every guard is spawned through, and `cwd` is this checkout
   * so that resolution is about the installed loader rather than about the
   * scratch root under test.
   */
  function resolveInChild(root: string, env: Record<string, string>): string {
    const helper = path.join(__dirname, "helpers", "guard-fixture.ts");
    const script = `
      const { tsxLoaderIn } = require(${JSON.stringify(helper)});
      try {
        process.stdout.write("ANSWERED " + tsxLoaderIn(${JSON.stringify(root)}));
      } catch (error) {
        process.stdout.write("REFUSED " + error.message);
      }
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const stdout = result.stdout ?? "";
    assert.ok(
      stdout.startsWith("ANSWERED ") || stdout.startsWith("REFUSED "),
      `the child never reported: status ${result.status}, stdout "${stdout}", stderr "${result.stderr ?? ""}"`,
    );
    return stdout;
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

  it("refuses a loader that only a global folder can see", () => {
    // `require.resolve`'s `paths` replaces the resolution roots "with the
    // exception of GLOBAL_FOLDERS", so `$NODE_PATH` answers for a checkout with
    // no install of its own — and the spawn this check clears is `node --import
    // tsx`, an ESM resolution, which consults no global folder at all. That is
    // the empty-pipes failure the check exists to prevent, arriving through a
    // green check: the developer with a global `tsx` gets the confusing run and
    // nothing tells them their checkout was never installed.
    //
    // NODE_PATH is read once at startup, so the only honest way to put a loader
    // on a global path is a child process that starts with one.
    inScratchCheckout((bare) => {
      inScratchCheckout((globals) => {
        plantGlobalTsx(globals);
        const answer = resolveInChild(bare, { NODE_PATH: globals });
        assert.match(
          answer,
          /^REFUSED /,
          `a loader reachable only through $NODE_PATH satisfied the check:\n${answer}`,
        );
        assert.match(answer, /GLOBAL_FOLDERS/);
        assert.match(answer, /npm ci/);
        assert.ok(
          answer.includes(path.join(bare, "node_modules")),
          `the diagnosis does not name the directory that should have answered:\n${answer}`,
        );
      });
    });
  });

  it("refuses a half-written install that a global folder finishes for it", () => {
    // The combination the two halves above cannot show on their own, and the
    // one an existence test on the chain entry waves through: `node_modules/
    // tsx` is there and unloadable (an interrupted `npm ci`), so the resolver
    // skips it, falls through to `$NODE_PATH` and succeeds — in a checkout
    // whose own install is broken. Taking the entry's presence as proof it
    // answered would clear this, and the spawn would then fail with the empty
    // pipes both halves exist to prevent.
    inScratchCheckout((half) => {
      inScratchCheckout((globals) => {
        fs.mkdirSync(path.join(half, "node_modules", "tsx"), { recursive: true });
        plantGlobalTsx(globals);
        const answer = resolveInChild(half, { NODE_PATH: globals });
        assert.match(
          answer,
          /^REFUSED /,
          `an unloadable chain entry was read as the install that answered:\n${answer}`,
        );
        assert.match(answer, /GLOBAL_FOLDERS/);
      });
    });
  });

  it("names the errno for a chain link it could not read, instead of blaming a global folder", () => {
    // "It is not there" and "this process cannot look at it" are different
    // findings: an `EACCES` on a directory the runner cannot traverse, an
    // `ELOOP` on a symlink cycle and an `ENAMETOOLONG` all used to arrive as
    // the GLOBAL_FOLDERS sentence, which names a rule that had nothing to do
    // with it and prescribes `npm ci`, which cannot fix any of the three. The
    // unreadable link may be the very install the resolver loaded, so the only
    // honest report is that the question could not be decided.
    //
    // A symlink cycle rather than a chmod, because this suite runs as root in
    // CI containers and root traverses an `EACCES` directory anyway — the
    // permissions case would pass without ever producing an errno.
    inScratchCheckout((looping) => {
      inScratchCheckout((globals) => {
        const chainLink = path.join(looping, "node_modules");
        fs.symlinkSync("node_modules", chainLink);
        plantGlobalTsx(globals);
        const answer = resolveInChild(looping, { NODE_PATH: globals });
        assert.match(
          answer,
          /^REFUSED /,
          `a checkout whose own chain could not be read satisfied the check:\n${answer}`,
        );
        assert.ok(
          answer.includes(`${chainLink} (ELOOP)`),
          `the diagnosis names neither the unreadable link nor why it could not be read:\n${answer}`,
        );
        assert.doesNotMatch(
          answer,
          /GLOBAL_FOLDERS/,
          `an unreadable chain link is reported as the global-folder finding, which is a different problem with a different fix:\n${answer}`,
        );
        assert.doesNotMatch(
          answer,
          /npm ci/,
          `the diagnosis prescribes \`npm ci\`, which changes nothing about a link this process cannot read:\n${answer}`,
        );
      });
    });
  });

  it("names every unreadable link, not just the first one", () => {
    // The walk collects a list and every case until this one planted exactly
    // one link, so a `[0]` in place of the join, a de-dup that kept the first,
    // or a `break` on the first finding would all pass while telling the
    // reader to fix one of two paths — and the second is discovered only after
    // the re-run they were told would work.
    inScratchCheckout((globals) => {
      plantGlobalTsx(globals);
      inScratchCheckout((outer) => {
        const nearer = path.join(outer, "inner");
        fs.mkdirSync(nearer, { recursive: true });
        const links = [path.join(nearer, "node_modules"), path.join(outer, "node_modules")];
        for (const link of links) fs.symlinkSync("node_modules", link);
        const answer = resolveInChild(nearer, { NODE_PATH: globals });
        assert.match(answer, /^REFUSED /, `two unreadable links satisfied the check:\n${answer}`);
        for (const link of links) {
          assert.ok(
            answer.includes(`${link} (ELOOP)`),
            `the report names ${links.length} unreadable links and omits ${link}:\n${answer}`,
          );
        }
        assert.match(
          answer,
          /2 of the `node_modules` directories/,
          `the count and the list disagree, so one of them is guessing:\n${answer}`,
        );
      });
    });
  });

  it("says a chain link is a file, instead of leaving a `node_modules` in the listing unexplained", () => {
    // `realpath` reports ENOTDIR only for a component short of the last, and
    // every chain link is an ancestor directory plus the name `node_modules` —
    // so a stray FILE under that name resolves cleanly, matches nothing, and
    // used to leave the walk without a word. node skips it too, so the refusal
    // is right; what was missing is the reason, which the reader can otherwise
    // see contradicted by their own `ls`.
    inScratchCheckout((globals) => {
      plantGlobalTsx(globals);
      inScratchCheckout((root) => {
        const stray = path.join(root, "node_modules");
        fs.writeFileSync(stray, "not a directory\n");
        const answer = resolveInChild(root, { NODE_PATH: globals });
        assert.match(answer, /^REFUSED /, `a file named node_modules answered the check:\n${answer}`);
        assert.ok(
          answer.includes(stray),
          `the diagnosis does not name the file standing where the install belongs:\n${answer}`,
        );
        assert.match(
          answer,
          /is not a directory/,
          `the diagnosis names the path without saying what is wrong with it:\n${answer}`,
        );
        assert.match(
          answer,
          /GLOBAL_FOLDERS/,
          `the file finding replaced the global-folder one, which is still the answer to where the loader came from:\n${answer}`,
        );
      });
    });
  });

  it("accepts an install found past a link it could not read", () => {
    // The other side of that line: an unreadable link is a reason to withhold
    // the answer, not to refuse. The chain is walked nearest-first, so a cycle
    // at the nearest link followed by the real hoisted install one directory up
    // is a checkout node resolves perfectly well — reporting the errno there
    // would refuse an install the spawn goes on to load.
    const nested = fs.mkdtempSync(path.join(REPO_ROOT, "guard-fixture-nested-"));
    try {
      fs.symlinkSync("node_modules", path.join(nested, "node_modules"));
      assert.equal(tsxLoaderIn(nested), "tsx");
    } finally {
      fs.rmSync(nested, { recursive: true, force: true });
    }
  });

  it("accepts an install the checkout owns but does not contain", () => {
    // The other side of the same line, and the reason the check is not a plain
    // "is the resolved file under the root": a resolved path is REALPATHED, so
    // a symlinked or store-backed install (pnpm, `npm link`, a workspace) lands
    // outside the tree while being exactly the install the spawn loads.
    // Refusing it would be a refusal nobody could act on — `npm ci` is already
    // what produced it.
    inScratchCheckout((root) => {
      fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
      fs.symlinkSync(
        path.join(REPO_ROOT, "node_modules", "tsx"),
        path.join(root, "node_modules", "tsx"),
      );
      assert.equal(tsxLoaderIn(root), "tsx");
    });
  });

  it("accepts a hoisted install one directory up, which the spawn would load", () => {
    // A checkout with no `node_modules` of its own is not the same as one with
    // no install: node walks every ancestor for a bare specifier, and so does
    // the ESM resolver the spawn uses. A subdirectory of this repository is the
    // real shape of that, and it must not be read as the global-folder case.
    const nested = fs.mkdtempSync(path.join(REPO_ROOT, "guard-fixture-nested-"));
    try {
      assert.equal(tsxLoaderIn(nested), "tsx");
    } finally {
      fs.rmSync(nested, { recursive: true, force: true });
    }
  });

  it("renders three distinct refusals, so no two of them can drift together", () => {
    // Each of the three is pinned by its own `assert.match` in its own case,
    // which says nothing about the three being DIFFERENT — and the first draft
    // of the unreadable-link message repeated `npm ci` from the global-folder
    // one, which is exactly the drift an individual match cannot see. The
    // reader's whole map of what went wrong is which sentence they got.
    inScratchCheckout((globals) => {
      plantGlobalTsx(globals);
      inScratchCheckout((absent) => {
        inScratchCheckout((looping) => {
          fs.symlinkSync("node_modules", path.join(looping, "node_modules"));
          const rendered = [
            refusalFor(absent),
            resolveInChild(absent, { NODE_PATH: globals }),
            resolveInChild(looping, { NODE_PATH: globals }),
          ].map((message) =>
            // The roots are mkdtemp names, so they differ on every run and
            // would make three identical sentences look distinct.
            [absent, looping, globals].reduce(
              (text, root) => text.split(root).join("<root>"),
              message,
            ),
          );
          assert.equal(
            new Set(rendered).size,
            rendered.length,
            `two of the three loader refusals render the same sentence, so the reader cannot tell which finding they got:\n${rendered.join("\n---\n")}`,
          );
          // Whole-string distinctness is the weakest form of the property this
          // case is named for, and not the shape the drift it was written for
          // actually had: the `npm ci` repeat arrived as one clause, in
          // messages that still differed by a path further down. Two refusals
          // that have converged on the same OPENING are two refusals a reader
          // stops distinguishing, whatever their tails do — the first sentence
          // is what gets read, quoted into an issue and searched for.
          const openings = rendered.map(leadingSentence);
          assert.equal(
            new Set(openings).size,
            openings.length,
            `two of the three loader refusals open with the same sentence, so the finding a reader takes away is the same one:\n${openings.join("\n---\n")}`,
          );
          for (const [index, opening] of openings.entries()) {
            assert.notEqual(
              opening,
              rendered[index],
              `refusal ${index + 1} is one unbroken sentence, so the opening compared above is its whole text and the check is the whole-string one again:\n${opening}`,
            );
          }
        });
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

describe("describeResolveFailure", () => {
  // The whole classification behind the unreadable-link report, and a pure
  // function of one argument — so the rows that would each need their own
  // kernel state (an unreadable directory, a name too long for the
  // filesystem, an `fs` that throws something without a `code`) are a table.

  it("stays silent for the two codes that mean the path is simply not there", () => {
    // The ordinary state of nearly every ancestor's `node_modules`. Reporting
    // these would bury the real finding under one line per ancestor.
    for (const code of ["ENOENT", "ENOTDIR"]) {
      assert.equal(
        describeResolveFailure(Object.assign(new Error("boom"), { code })),
        null,
        `${code} is reported as unreadable, which would fire on every checkout`,
      );
    }
  });

  it("reports the errno for every other code", () => {
    for (const code of ["EACCES", "ELOOP", "ENAMETOOLONG", "EPERM"]) {
      assert.equal(describeResolveFailure(Object.assign(new Error("boom"), { code })), code);
    }
  });

  it("says so in words when the error carries no code, rather than inventing one", () => {
    // `UNKNOWN` in the slot where every other row prints an errno reads like a
    // real filesystem code, and the reader spends the next minute looking it
    // up. The message is the only thing actually known here.
    const detail = describeResolveFailure(new Error("realpath went sideways\n    at frame"));
    assert.equal(detail, "no errno: realpath went sideways");
    assert.doesNotMatch(String(detail), /UNKNOWN/);
  });

  it("survives a thrown non-error", () => {
    // `catch` binds whatever was thrown, and this one is rendered straight
    // into a refusal — a `String(...)` away from a TypeError inside the
    // diagnosis that was supposed to explain the failure.
    assert.equal(describeResolveFailure("not an error"), "no errno: 'not an error'");
    assert.equal(describeResolveFailure(null), "no errno: null");
  });

  it("describes a thrown object, rather than naming the language's fallback", () => {
    // `[object Object]` in this slot tells the reader strictly less than the
    // word "unknown" would: it is what every object without a `toString`
    // renders as, so it says the throw happened and nothing about what threw.
    const detail = String(describeResolveFailure({ errno: -13, syscall: "realpath" }));
    assert.doesNotMatch(
      detail,
      /\[object Object\]/,
      `a thrown object is rendered as the fallback every object shares:\n${detail}`,
    );
    assert.ok(
      detail.includes("realpath"),
      `the rendering drops the fields that say what was thrown:\n${detail}`,
    );
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
