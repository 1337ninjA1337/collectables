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
  EMPTY_LINK_PHRASE,
  entryPatch,
  makePartialRoot,
  makeSharedPatchedRepo,
  OBSTRUCTION_PHRASE,
  PATCHED_REPO_MARKER,
  probeAbsentLink,
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
        assert.ok(
          answer.includes(OBSTRUCTION_PHRASE["not-directory"]),
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

  it("says a chain link is a symlink pointing at nothing, instead of calling it absent", () => {
    // `realpath` on a dangling link is ENOENT, which is also what every
    // ancestor without a `node_modules` reports — and the classification is
    // right to stay silent for those. This one is not the same finding: the
    // path exists, a person made it (`ln -s ../shared/node_modules`, target
    // since moved), and it is the whole reason the install they believe they
    // linked is not being found. An `lstat` in the branch that already said
    // "not there" is what tells the two apart.
    inScratchCheckout((globals) => {
      plantGlobalTsx(globals);
      inScratchCheckout((root) => {
        const link = path.join(root, "node_modules");
        fs.symlinkSync(path.join(root, "target-that-was-moved"), link);
        const answer = resolveInChild(root, { NODE_PATH: globals });
        assert.match(answer, /^REFUSED /, `a dangling chain link answered the check:\n${answer}`);
        assert.ok(
          answer.includes(link),
          `the diagnosis does not name the link standing where the install belongs:\n${answer}`,
        );
        assert.ok(
          answer.includes(OBSTRUCTION_PHRASE["dangling-link"]),
          `a dangling link is reported as plain absence, which is what every ancestor looks like:\n${answer}`,
        );
      });
    });
  });

  it("says the nearest `node_modules` is empty, instead of reading like an absent one", () => {
    // The most common real version of "the install is not where you think" —
    // an interrupted `npm ci`, a pruned store, a cleaned cache — and until now
    // the one the walk could not see at all: it asks only whether `tsx` is
    // under each link, so an empty directory answers with the same silence as
    // a healthy one. Byte for byte, the refusal was the one for a checkout
    // with no `node_modules` whatsoever, which sends the reader looking for a
    // directory that is sitting right there in their listing.
    inScratchCheckout((root) => {
      const link = path.join(root, "node_modules");
      fs.mkdirSync(link);
      const message = refusalFor(root);
      assert.ok(
        message.includes(link),
        `the diagnosis does not name the empty directory:\n${message}`,
      );
      assert.ok(
        message.includes(EMPTY_LINK_PHRASE.empty),
        `an empty install directory is reported as a plainly absent one:\n${message}`,
      );
    });
  });

  it("carries the empty-directory finding into the global-folder refusal too", () => {
    // The combination the case above cannot show: an empty local install plus
    // a loadable `$NODE_PATH` resolves, so the refusal is the global-folder
    // one — and that message's whole claim is "your own `node_modules` did not
    // answer", which the reader is entitled to see a reason for.
    inScratchCheckout((globals) => {
      plantGlobalTsx(globals);
      inScratchCheckout((root) => {
        const link = path.join(root, "node_modules");
        fs.mkdirSync(link);
        const answer = resolveInChild(root, { NODE_PATH: globals });
        assert.match(answer, /^REFUSED /, `an empty install satisfied the check:\n${answer}`);
        assert.match(answer, /GLOBAL_FOLDERS/);
        assert.ok(
          answer.includes(`${link} ${EMPTY_LINK_PHRASE.empty}`),
          `the global-folder refusal drops the reason the checkout's own directory said nothing:\n${answer}`,
        );
      });
    });
  });

  it("says a `node_modules` holding only npm's own bookkeeping holds no packages", () => {
    // The same failure wearing a hat, and the one a bare entry COUNT waves
    // through: npm writes `.package-lock.json` before it restores the store,
    // and a prune leaves `.bin` and `.cache` behind, so an interrupted install
    // commonly ends with a directory that is not empty and still holds nothing
    // node can load. Counting entries sends that reader back to the refusal
    // this finding exists to replace, with the added confusion of a message
    // that explicitly declined to call the directory empty.
    for (const bookkeeping of [[".package-lock.json"], [".bin", ".cache"]]) {
      inScratchCheckout((root) => {
        const link = path.join(root, "node_modules");
        fs.mkdirSync(link);
        for (const entry of bookkeeping) fs.writeFileSync(path.join(link, entry), "{}\n");
        const message = refusalFor(root);
        assert.ok(
          message.includes(`${link} ${EMPTY_LINK_PHRASE["no-packages"]}`),
          `a \`node_modules\` holding only ${bookkeeping.join(", ")} is reported as a healthy one:\n${message}`,
        );
        assert.ok(
          !message.includes(EMPTY_LINK_PHRASE.empty),
          `a directory with entries in it is called empty, which its owner's own \`ls\` contradicts:\n${message}`,
        );
      });
    }
  });

  it("says nothing about a `node_modules` holding a scoped package", () => {
    // The negative the dotted-name rule has to survive: a package directory IS
    // the specifier, and `@scope` is the one shape that is neither a plain name
    // nor a dotfile. A rule written as "no plain names" rather than "no
    // undotted names" would tell a workspace with only scoped dependencies
    // installed that it holds no packages at all.
    inScratchCheckout((root) => {
      fs.mkdirSync(path.join(root, "node_modules", "@scope", "thing"), { recursive: true });
      const message = refusalFor(root);
      for (const phrase of Object.values(EMPTY_LINK_PHRASE)) {
        assert.ok(
          !message.includes(phrase),
          `a \`node_modules\` holding a scoped package is reported as holding none ("${phrase}"):\n${message}`,
        );
      }
    });
  });

  it("says nothing about emptiness when the nearest link holds something", () => {
    // The negative that keeps the sentence worth reading, and the one a bare
    // `existsSync`-shaped probe would get wrong: a `node_modules` with a
    // half-written `tsx` in it is not empty, and telling its owner it is sends
    // them to fix the wrong thing. `readdirSync` has to be asked, and its
    // answer has to be used.
    inScratchCheckout((root) => {
      fs.mkdirSync(path.join(root, "node_modules", "tsx"), { recursive: true });
      const message = refusalFor(root);
      for (const phrase of Object.values(EMPTY_LINK_PHRASE)) {
        assert.ok(
          !message.includes(phrase),
          `a populated \`node_modules\` is reported as holding no install ("${phrase}"):\n${message}`,
        );
      }
    });
  });

  it("says nothing about emptiness when there is no `node_modules` at all", () => {
    // The other negative, and the finding's whole reason for existing: these
    // two refusals used to be identical and now must differ. A probe that
    // reported absence as emptiness would make them identical again, in the
    // other direction.
    inScratchCheckout((bare) => {
      inScratchCheckout((empty) => {
        fs.mkdirSync(path.join(empty, "node_modules"));
        const absent = refusalFor(bare);
        const hollow = refusalFor(empty);
        for (const phrase of Object.values(EMPTY_LINK_PHRASE)) {
          assert.ok(
            !absent.includes(phrase),
            `a checkout with no \`node_modules\` is told about the contents of one ("${phrase}"):\n${absent}`,
          );
        }
        assert.notEqual(
          absent.split(bare).join("<root>"),
          hollow.split(empty).join("<root>"),
          "an absent `node_modules` and an empty one produce the same refusal, so the reader cannot tell which of the two they have",
        );
      });
    });
  });

  it("says nothing extra when nothing is standing in the chain, in any of the three refusals", () => {
    // The negative half of the two cases above, and the one that keeps them
    // worth reading: a clause that appears when nothing is wrong teaches the
    // reader to skip the tail of every message, including the one that names
    // their actual problem. A checkout with a plainly absent install is the
    // ordinary refusal and must stay one sentence shorter.
    //
    // All THREE refusals, not just the absent-install one this case used to
    // read. The clause is appended to the global-folder and unreadable-link
    // messages as well, so a regression that made it unconditional in either
    // of those would have left the old single-message version green — while
    // every reader of the two messages it does reach gets a paragraph about
    // paths that are perfectly fine. Each root here is refused for its own
    // reason and has nothing standing in its chain.
    inScratchCheckout((globals) => {
      plantGlobalTsx(globals);
      inScratchCheckout((absent) => {
        inScratchCheckout((looping) => {
          fs.symlinkSync("node_modules", path.join(looping, "node_modules"));
          const refusals = [
            ["absent install", refusalFor(absent)],
            ["global folder", resolveInChild(absent, { NODE_PATH: globals })],
            ["unreadable link", resolveInChild(looping, { NODE_PATH: globals })],
          ] as const;
          for (const [name, message] of refusals) {
            assert.doesNotMatch(
              message,
              /Note also/,
              `the ${name} refusal carries the standing-in-the-way clause for a chain with nothing in the way:\n${message}`,
            );
            for (const phrase of Object.values(OBSTRUCTION_PHRASE)) {
              assert.ok(
                !message.includes(phrase),
                `the ${name} refusal says "${phrase}" about a chain with nothing in the way:\n${message}`,
              );
            }
          }
        });
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

describe("the obstruction phrasing table", () => {
  // The phrases used to be free-text fragments written at the two sites that
  // build the finding, and they were grammatical only because both were typed
  // to fit the one template that renders them. Closing the union moved the
  // wording here; these rows are what stops the next one being added without
  // reading the sentence it lands in.

  const KINDS = Object.keys(OBSTRUCTION_PHRASE) as (keyof typeof OBSTRUCTION_PHRASE)[];

  it("still carries the two kinds the walk can produce", () => {
    // A rename that dropped a row would otherwise show up only as a refusal
    // that suddenly renders `undefined` next to a path.
    assert.deepEqual(KINDS.sort(), ["dangling-link", "not-directory"]);
  });

  it("reads as a verb phrase completing the path it follows", () => {
    // The clause renders `<path> (<phrase>)` and then says "those paths are in
    // the chain node searches", so a noun ("a file"), a capital or a trailing
    // period each break the sentence at a different seam.
    for (const kind of KINDS) {
      const phrase = OBSTRUCTION_PHRASE[kind];
      assert.match(phrase, /^is /, `${kind} does not complete "<path> …": ${phrase}`);
      assert.doesNotMatch(phrase, /[.\n]/, `${kind} punctuates itself: ${phrase}`);
      assert.equal(phrase.trim(), phrase, `${kind} is padded: "${phrase}"`);
    }
  });

  it("says something different for each kind", () => {
    // Two kinds rendering the same words is two findings the reader cannot
    // act on differently — a file to delete and a link to repoint.
    const phrases = KINDS.map((kind) => OBSTRUCTION_PHRASE[kind]);
    assert.equal(new Set(phrases).size, phrases.length, phrases.join(" / "));
  });
});

describe("the empty-link phrasing table", () => {
  // Same treatment as the obstruction table, for the same reason: the cases
  // that assert this clause read the phrase from here, so a rewording either
  // updates its pins or fails them — rather than leaving a suite green while
  // it asserts the absence of prose the fixture no longer prints.

  const KINDS = Object.keys(EMPTY_LINK_PHRASE) as (keyof typeof EMPTY_LINK_PHRASE)[];

  it("still carries the two ways a link can be there and hold no install", () => {
    assert.deepEqual(KINDS.sort(), ["empty", "no-packages"]);
  });

  it("reads as a verb phrase the clause can continue", () => {
    // Rendered as `<path> <phrase>, so node had nothing to search in it` — so a
    // capital, a trailing period or padding each break the sentence.
    for (const kind of KINDS) {
      const phrase = EMPTY_LINK_PHRASE[kind];
      assert.match(phrase, /^is /, `${kind} does not complete "<path> …": ${phrase}`);
      assert.doesNotMatch(phrase, /[.\n]$/, `${kind} punctuates itself: ${phrase}`);
      assert.equal(phrase.trim(), phrase, `${kind} is padded: "${phrase}"`);
    }
  });

  it("says something different for each kind", () => {
    // A directory with nothing in it and one holding only npm's bookkeeping
    // are the same fix and different `ls` output; a reader who is told the
    // wrong one starts by doubting the message.
    const phrases = KINDS.map((kind) => EMPTY_LINK_PHRASE[kind]);
    assert.equal(new Set(phrases).size, phrases.length, phrases.join(" / "));
    assert.ok(
      !phrases.some((phrase) => phrases.some((other) => other !== phrase && other.includes(phrase))),
      `one phrase contains another, so an \`includes\` pin on the shorter one is satisfied by the longer: ${phrases.join(" / ")}`,
    );
  });
});

describe("probeAbsentLink", () => {
  // The branch reached once `realpath` has answered "not there". Its catch
  // used to swallow every `lstat` failure as ordinary absence, which is the
  // same collapse the unreadable finding exists to stop, one level down: an
  // `EACCES` on the PARENT directory makes `lstat` throw for a link that may
  // well exist. `lstat` is injectable here for exactly this table — as root in
  // a CI container the permission rows cannot be arranged, and every state
  // `realpath` reports with a non-absence code is answered before this runs.

  const LINK = "/checkout/node_modules";
  const asSymlink = (isLink: boolean) => () => ({ isSymbolicLink: () => isLink });
  const throwing = (error: unknown) => () => {
    throw error;
  };

  it("reports a dangling symlink as something standing in the chain", () => {
    assert.deepEqual(probeAbsentLink(LINK, asSymlink(true)), {
      unreadable: null,
      obstruction: { path: LINK, kind: "dangling-link" },
    });
  });

  it("reports nothing for a path that is simply not there", () => {
    for (const code of ["ENOENT", "ENOTDIR"]) {
      assert.deepEqual(
        probeAbsentLink(LINK, throwing(Object.assign(new Error("boom"), { code }))),
        { unreadable: null, obstruction: null },
        `${code} on the lstat produced a finding, which would fire on every ancestor of every checkout`,
      );
    }
  });

  it("routes an lstat that failed for its own reason into the unreadable list", () => {
    // The whole point of the change: "this process cannot look at the link"
    // must not arrive as "the link is not there", because the two have
    // different fixes and only one of them is the reader's fault.
    for (const code of ["EACCES", "ELOOP", "ENAMETOOLONG"]) {
      assert.deepEqual(
        probeAbsentLink(LINK, throwing(Object.assign(new Error("boom"), { code }))),
        { unreadable: { path: LINK, detail: code }, obstruction: null },
        `${code} on the lstat was swallowed as ordinary absence`,
      );
    }
  });

  it("keeps a thrown value with no errno readable rather than dropping it", () => {
    // Same classification as everywhere else, so a patched `fs` or a thrown
    // non-Error cannot make this the one place that says nothing.
    const finding = probeAbsentLink(LINK, throwing("lstat exploded"));
    assert.equal(finding.obstruction, null);
    assert.ok(
      finding.unreadable?.detail.includes("lstat exploded"),
      `the thrown value is dropped from the finding: ${JSON.stringify(finding)}`,
    );
  });

  it("reports nothing for a path that is there and is not a link", () => {
    // A race — `realpath` said absent and the path was created in between —
    // and the one case where saying nothing is right.
    assert.deepEqual(probeAbsentLink(LINK, asSymlink(false)), {
      unreadable: null,
      obstruction: null,
    });
  });

  it("defaults to the real lstat, so callers get the filesystem", () => {
    // The parameter exists for the table above; a default that had drifted to
    // a stub would make every case here a test of the test.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "absent-link-"));
    try {
      const link = path.join(root, "node_modules");
      fs.symlinkSync(path.join(root, "gone"), link);
      assert.deepEqual(probeAbsentLink(link), {
        unreadable: null,
        obstruction: { path: link, kind: "dangling-link" },
      });
      assert.deepEqual(probeAbsentLink(path.join(root, "nothing-here")), {
        unreadable: null,
        obstruction: null,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
