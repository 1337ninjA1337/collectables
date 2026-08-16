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
  EMPTY_LINK_TAIL,
  emptyLinkClause,
  emptyLinkFrom,
  entryPatch,
  looksLikePackageEntry,
  makePartialRoot,
  makeSharedPatchedRepo,
  nearestChainLink,
  nodeModulesChain,
  OBSTRUCTION_PHRASE,
  obstructionClause,
  PATCHED_REPO_MARKER,
  probeAbsentLink,
  probeNearestLink,
  probeResolvedLink,
  SYSCALL_IMPLICATION,
  tsxLoaderIn,
  unreadableList,
} from "./helpers/guard-fixture";
import { assertPhraseTable } from "./helpers/phrase-table";

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
          answer.includes(`${chainLink} (ELOOP on realpath — ${SYSCALL_IMPLICATION.realpath})`),
          `the diagnosis names neither the unreadable link, nor why it could not be read, nor which call said so:\n${answer}`,
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
            answer.includes(`${link} (ELOOP on realpath`),
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

  it("tells each refusal what the empty directory means for IT, not what it means for the other one", () => {
    // One finding, two refusals, and only the finding is shared. The tail used
    // to be a single sentence — "this refusal reads exactly like one for a
    // checkout with no `node_modules` at all" — written for the absent-install
    // message and carried into the global-folder one by the same interpolation.
    // In the second it is a claim the reader can check and disprove in the
    // paragraph above it, which opens by naming the path `$NODE_PATH` answered
    // with; a message that gets a checkable claim wrong is worse than one that
    // makes none, because it costs the rest of the message its credit.
    inScratchCheckout((globals) => {
      plantGlobalTsx(globals);
      inScratchCheckout((root) => {
        fs.mkdirSync(path.join(root, "node_modules"));
        const refusals = [
          ["absent-install", refusalFor(root)],
          ["global-folder", resolveInChild(root, { NODE_PATH: globals })],
        ] as const;
        for (const [host, message] of refusals) {
          assert.ok(
            message.includes(EMPTY_LINK_TAIL[host]),
            `the ${host} refusal drops its own reading of the empty directory:\n${message}`,
          );
          for (const [other, tail] of Object.entries(EMPTY_LINK_TAIL)) {
            if (other === host) continue;
            assert.ok(
              !message.includes(tail),
              `the ${host} refusal carries the ${other} tail ("${tail}"), which is not true of it:\n${message}`,
            );
          }
        }
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
    // the chain node searches", so a noun ("a file"), a capital or a period
    // anywhere at all break the sentence at a different seam. Distinctness and
    // containment ride along with the shape rules now — this table went without
    // the containment check for no reason other than that the suite it was
    // copied from predated it.
    assertPhraseTable(OBSTRUCTION_PHRASE, {
      opens: /^is /,
      // Every kind, rendered by the builder the refusals call. Until the clause
      // was exported this cost a planted filesystem and a spawned child per
      // row, which is why the table's rows were pinned for how they READ and
      // never for whether anything prints them — a kind sketched ahead
      // ("socket", "no-execute-bit") passed every assertion and shipped as dead
      // prose that reads like a finding the walk knows how to make.
      renderedIn: KINDS.map((kind) => obstructionClause([{ path: "/checkout/node_modules", kind }])),
      // Rendered as `<path> (<phrase>)` with the clause continuing on the far
      // side of the parenthesis, so a period anywhere ends the sentence inside
      // it. Nothing in this table names a dotted file, so the strict rule costs
      // it nothing.
      periods: "never",
      template: "<path> (<phrase>) — those paths are in the chain node searches",
    });
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
    // A directory with nothing in it and one holding only npm's bookkeeping are
    // the same fix and different `ls` output, so the rows have to stay distinct
    // — and non-containing, since the negative cases pin the absence of the
    // shorter row with `includes`.
    assertPhraseTable(EMPTY_LINK_PHRASE, {
      opens: /^is /,
      renderedIn: KINDS.map((kind) =>
        emptyLinkClause({ path: "/checkout/node_modules", kind }, "absent-install"),
      ),
      // Not "never": the `no-packages` row names `.package-lock.json` and
      // `.bin`, which is the whole point of that row — the reader recognises
      // their own listing in it. Only a period at the END would close the
      // sentence the clause carries on.
      periods: "not-at-the-end",
      template: "<path> <phrase>, so node had nothing to search in it",
    });
  });
});

describe("looksLikePackageEntry", () => {
  // The rule the emptiness probe is built on, which used to be a doc comment
  // over an inline `!entry.startsWith(".")` at one call site — a claim about
  // how node resolves, stated in prose and enforced in an expression, with no
  // way to read the two against each other. Named, it gets the rows that
  // matter as a table: reaching them through the probe means planting a
  // directory and spawning a child per shape, which is why only two of these
  // were ever covered.

  const ROWS: readonly [entry: string, loadable: boolean, why: string][] = [
    ["tsx", true, "a plain name is a specifier node resolves directly"],
    ["react-native", true, "a hyphen is ordinary in a package name"],
    ["@scope", true, "a scope directory holds packages, and is neither a plain name nor a dotfile"],
    [".package-lock.json", false, "npm writes this BEFORE it restores the store"],
    [".bin", false, "a prune leaves the shim directory behind"],
    [".cache", false, "so does a cleaned cache"],
    [".modules.yaml", false, "pnpm's own bookkeeping, and the reason the rule is dots and not a list"],
  ];

  for (const [entry, loadable, why] of ROWS) {
    it(`${loadable ? "counts" : "does not count"} \`${entry}\``, () => {
      assert.equal(looksLikePackageEntry(entry), loadable, why);
    });
  }

  it("draws the line at the dot rather than at a list of npm's filenames", () => {
    // The rule has to survive names nobody here has seen: a bookkeeping file
    // some future npm writes is excluded because it is dotted, not because it
    // was enumerated, and a package named after one of them is still a package.
    assert.equal(looksLikePackageEntry(".whatever-npm-writes-next"), false);
    assert.equal(looksLikePackageEntry("bin"), true, "an undotted `bin` is a package, not npm's shim directory");
  });
});

describe("the empty-link tail table", () => {
  // What the finding MEANS, which is the half that is not shared between the
  // two refusals it lands in. The tail was one sentence written for the
  // absent-install message and carried into the global-folder one by the same
  // interpolation, where it claimed something the reader could see was false:
  // that message opens by naming a path it resolved through `$NODE_PATH`, and
  // reads nothing like a refusal for a checkout with no `node_modules` at all.

  it("still carries one tail per refusal the clause is appended to", () => {
    assert.deepEqual(Object.keys(EMPTY_LINK_TAIL).sort(), ["absent-install", "global-folder"]);
  });

  it("reads as a clause continuing the sentence that renders it", () => {
    assertPhraseTable(EMPTY_LINK_TAIL, {
      renderedIn: (Object.keys(EMPTY_LINK_TAIL) as (keyof typeof EMPTY_LINK_TAIL)[]).map((host) =>
        emptyLinkClause({ path: "/checkout/node_modules", kind: "empty" }, host),
      ),
      // A subject rather than a verb — these complete "… and <tail>", not
      // "<path> …" — so the rule is only that a row does not open mid-word or
      // with the punctuation the template supplies.
      opens: /^[a-z]/,
      // Continued by " — an interrupted `npm ci` …", so a trailing period
      // orphans that half; nothing here names a dotted file, but the em-dash
      // continuation is the same shape the phrase table has.
      periods: "not-at-the-end",
      template: "so node had nothing to search in it and <tail> — an interrupted `npm ci` …",
    });
  });
});

describe("the clause builders", () => {
  // All three are pure, and until they were exported the only way to reach any
  // of them was through a refusal — so "no findings in, no clause out", which
  // is a one-row table, was proved by spawning node twice with a planted
  // `NODE_PATH` and a symlink cycle. The spawns are still worth paying for the
  // claim that genuinely needs them (the clause reaches a message a REAL walk
  // produced, which the loader-check suite asserts); these rows are the ones
  // that never needed a filesystem at all.

  const LINK = "/checkout/node_modules";
  const OTHER = "/checkout/../shared/node_modules";

  describe("obstructionClause", () => {
    it("says nothing for a chain with nothing in the way", () => {
      // The case that keeps the clause worth reading, and the reason it is a
      // row rather than two child processes.
      assert.equal(obstructionClause([]), "");
    });

    it("speaks of one path in the singular and of two in the plural", () => {
      // Four agreements in one sentence — "that path is"/"those paths are",
      // "skipped it"/"skipped them", "until it is"/"until they are" — and a
      // count that has to match the list beside it.
      const one = obstructionClause([{ path: LINK, kind: "not-directory" }]);
      assert.match(one, /that path is in the chain/);
      assert.match(one, /skipped it/);
      assert.match(one, /until it is removed/);

      const two = obstructionClause([
        { path: LINK, kind: "not-directory" },
        { path: OTHER, kind: "dangling-link" },
      ]);
      assert.match(two, /those paths are in the chain/);
      assert.match(two, /skipped them/);
      assert.match(two, /until they are removed/);
      for (const listed of [LINK, OTHER]) {
        assert.ok(two.includes(listed), `the clause lists two findings and omits ${listed}: ${two}`);
      }
    });
  });

  describe("emptyLinkClause", () => {
    it("says nothing when the nearest link holds something", () => {
      assert.equal(emptyLinkClause(null, "absent-install"), "");
      assert.equal(emptyLinkClause(null, "global-folder"), "");
    });

    it("names the path once, whichever refusal it is landing in", () => {
      // The path is the actionable half and the tail is the reading; a clause
      // that named the directory twice would read like two findings about it.
      for (const host of ["absent-install", "global-folder"] as const) {
        const clause = emptyLinkClause({ path: LINK, kind: "empty" }, host);
        assert.equal(
          clause.split(LINK).length - 1,
          1,
          `the ${host} clause names ${LINK} more than once: ${clause}`,
        );
      }
    });
  });

  describe("emptyLinkFrom", () => {
    // The probe half, now taking the link the WALK saw rather than re-probing
    // the same path one syscall later. The two could disagree — an install
    // landing between them is what a slow `npm ci` in another terminal produces
    // — and the refusal would then describe a state that no longer held when
    // the decision was made.

    const probed = (real: string | null): { path: string; link: ChainLink } => ({
      path: LINK,
      link: { real, unreadable: null, obstruction: null },
    });
    type ChainLink = { real: string | null; unreadable: null; obstruction: null };

    // There is no "the walk found no chain at all" row any more, and the one
    // that used to be here is why: it read as coverage of the filesystem root
    // and the filesystem root has a chain (`["/node_modules"]`), so it asserted
    // a state no root can be in. `nodeModulesChain` below pins the reason.

    it("says nothing when the walk could not resolve the nearest link", () => {
      // An absent, occupied or unreadable link is somebody else's finding, each
      // with its own sentence; answering here too would name one path twice
      // with two explanations.
      assert.equal(emptyLinkFrom(probed(null)), null);
    });

    it("reads the link the walk resolved, not the path it was asked about", () => {
      // The realpath is where the entries actually are — a symlinked install
      // (pnpm, a workspace) resolves elsewhere — while the path the READER
      // recognises is the one they can see in their own listing, so the finding
      // has to carry that one.
      const real = "/elsewhere/store/node_modules";
      const seen: string[] = [];
      const finding = emptyLinkFrom({ path: LINK, link: { real, unreadable: null, obstruction: null } }, (dir) => {
        seen.push(String(dir));
        return [];
      });
      assert.deepEqual(seen, [real], "the probe read a path other than the one the walk resolved");
      assert.deepEqual(finding, { path: LINK, kind: "empty" });
    });

    it("declines to speak when the listing itself fails", () => {
      // A link that cannot be read is the unreadable finding's path and its
      // sentence; this probe reporting on it as well would tell the reader to
      // fix one directory for two different reasons.
      assert.equal(
        emptyLinkFrom(probed("/checkout/node_modules"), () => {
          throw Object.assign(new Error("boom"), { code: "EACCES" });
        }),
        null,
      );
    });
  });

  describe("unreadableList", () => {
    it("says nothing for a walk that read every link", () => {
      assert.equal(unreadableList([]), "");
    });

    it("joins the findings so the count beside it can agree with them", () => {
      // The sentence renders the count from the array and the list from this
      // join, so the two agree by construction — which is exactly why the
      // separator has to stay a separator: a newline or a bullet here would
      // survive every existing pin and break the paragraph it is spliced into.
      const listed = unreadableList([
        { path: LINK, detail: "ELOOP", syscall: "realpath" },
        { path: OTHER, detail: "EACCES", syscall: "lstat" },
      ]);
      assert.equal(listed.split(", ").length >= 2, true, listed);
      assert.doesNotMatch(listed, /\n/, `the list spans lines and the message is a paragraph: ${listed}`);
      assert.ok(listed.includes("ELOOP on realpath"), listed);
      assert.ok(listed.includes("EACCES on lstat"), listed);
    });
  });
});

describe("nodeModulesChain", () => {
  // The two properties three readers depend on, neither of which anything
  // checked. "The first entry is the NEAREST link" was a sentence in a doc
  // comment, and it was where `nearest ??= …` in the walk, `chain[0]` in the
  // global-folder refusal and `probeNearestLink` all got their correctness
  // from — a reordering here (sorting, de-duplicating, dropping roots) would
  // have made all three wrong at once with every assertion still green,
  // because the fixtures that reach them have one-link chains.
  //
  // "There is always a first entry" is the other, and it was not merely
  // unchecked but WRONG in the direction that mattered: three functions carried
  // an empty-chain branch documented as "the root of a filesystem", and the
  // root of a filesystem is precisely the root that disproves it.

  const FS_ROOT = path.parse(path.resolve("/")).root;
  const rootLink = path.join(FS_ROOT, "node_modules");

  it("puts the checkout's own `node_modules` first", () => {
    assert.equal(nodeModulesChain("/a/b/c")[0], path.join("/a", "b", "c", "node_modules"));
  });

  it("climbs one directory at a time, ending at the filesystem root", () => {
    assert.deepEqual(
      [...nodeModulesChain("/a/b")],
      [path.join("/a", "b", "node_modules"), path.join("/a", "node_modules"), rootLink],
    );
  });

  it("orders every chain nearest first, which is what its first entry being the nearest means", () => {
    // The property in the form the readers actually depend on: each link's
    // directory strictly CONTAINS the next one's. A sort by name, a reverse or
    // a de-duplication that lost the order would fail here rather than in five
    // suites' worth of refusal text a year later.
    const chain = nodeModulesChain("/a/b/c/d");
    for (let i = 1; i < chain.length; i += 1) {
      const closer = path.dirname(chain[i - 1]);
      const further = path.dirname(chain[i]);
      assert.ok(
        closer.startsWith(further) && further.length < closer.length,
        `${chain[i]} is not an ancestor of ${chain[i - 1]}: the chain is not nearest-first`,
      );
    }
  });

  it("never comes back empty, so no caller needs a branch for a root without a nearest link", () => {
    for (const root of [FS_ROOT, rootLink, "/a/b", REPO_ROOT, path.join(REPO_ROOT, "node_modules")]) {
      const chain = nodeModulesChain(root);
      assert.ok(chain.length >= 1, `${root} produced an empty chain`);
      assert.equal(
        chain[chain.length - 1],
        rootLink,
        `the chain for ${root} does not end at the filesystem root, which is what makes it non-empty`,
      );
    }
  });

  it("never repeats a link, which is what lets the walk reuse a probe by position", () => {
    // The walk probes the nearest link once and reuses that answer for the
    // first iteration. It used to find that iteration by string match, which is
    // right only while no link appears twice — true here because every entry is
    // `join(dir, "node_modules")` for a strictly ascending `dir`, and stated
    // nowhere until this row. A normalisation or de-dup pass is what would
    // break it.
    for (const root of [REPO_ROOT, "/a/b/c/d", path.join("/a", "node_modules"), FS_ROOT]) {
      const chain = nodeModulesChain(root);
      assert.equal(
        new Set(chain).size,
        chain.length,
        `the chain for ${root} lists a link twice: ${chain.join(", ")}`,
      );
    }
  });

  it("gives the filesystem root the chain the deleted branch said it had none of", () => {
    // The whole argument in one row. `path.basename` of the filesystem root is
    // `""` — never `node_modules` — so the last iteration always pushes, and
    // `/` comes back with a chain of exactly one link rather than with nothing.
    assert.deepEqual([...nodeModulesChain(FS_ROOT)], [rootLink]);
  });

  it("skips a directory that is itself a `node_modules`, the way node does", () => {
    const chain = nodeModulesChain(path.join("/a", "node_modules"));
    assert.deepEqual([...chain], [path.join("/a", "node_modules"), rootLink]);
    assert.ok(
      !chain.includes(path.join("/a", "node_modules", "node_modules")),
      `the chain searches inside a \`node_modules\`, which node never does: ${chain.join(", ")}`,
    );
  });

  it("resolves a relative root before walking it", () => {
    assert.deepEqual([...nodeModulesChain(".")], [...nodeModulesChain(path.resolve("."))]);
  });
});

describe("nearestChainLink", () => {
  // The name three call sites used to spell `chain[0]` without saying why that
  // is the nearest one. Two of them read the walk's own answer now; this is the
  // reader for the refusal that has no walk behind it.

  const FS_ROOT = path.parse(path.resolve("/")).root;

  it("is the chain's first entry, for every shape of root the walk has", () => {
    for (const root of ["/a/b/c", path.join("/a", "node_modules"), FS_ROOT, REPO_ROOT]) {
      assert.equal(nearestChainLink(root), nodeModulesChain(root)[0], root);
    }
  });

  it("answers for the filesystem root rather than declining to", () => {
    assert.equal(nearestChainLink(FS_ROOT), path.join(FS_ROOT, "node_modules"));
  });
});

describe("probeNearestLink", () => {
  // The fresh probe, for the ONE refusal with no walk behind it: when
  // `require.resolve` itself throws there is no provenance to carry a probe out
  // of. Its claim has two halves — the path named is the nearest link, and what
  // is reported is a probe of THAT path — and until it was exported both were
  // reachable only by arranging a checkout the resolver refuses.

  const inScratch = (body: (root: string) => void): void => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nearest-chain-link-"));
    try {
      body(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  it("names the nearest link and reports what is really there", () => {
    inScratch((root) => {
      const link = path.join(root, "node_modules");
      fs.mkdirSync(link);
      const probed = probeNearestLink(root);
      assert.equal(probed.path, link, "the probe named a link other than the nearest one");
      assert.equal(probed.link.real, fs.realpathSync(link));
      assert.equal(probed.link.unreadable, null);
      assert.equal(probed.link.obstruction, null);
    });
  });

  it("carries the probe of a link that is not there rather than declining to answer", () => {
    // The absent-install refusal's own case: nothing is planted, so the nearest
    // link has no realpath, and the clause has to stay silent about it — which
    // is now the `real === null` line rather than the null the caller used to
    // be able to pass.
    inScratch((root) => {
      const probed = probeNearestLink(root);
      assert.equal(probed.path, path.join(root, "node_modules"));
      assert.equal(probed.link.real, null);
      assert.equal(emptyLinkFrom(probed), null);
    });
  });

  it("feeds the finding the absent-install refusal is built on", () => {
    // The two halves joined, without the spawn: an empty `node_modules` in the
    // checkout, probed fresh, is the finding the clause renders. A swap between
    // this probe and the walk's answer at either throw site changes which link
    // is reported, and this is the end that has no walk to compare against.
    inScratch((root) => {
      const link = path.join(root, "node_modules");
      fs.mkdirSync(link);
      assert.deepEqual(emptyLinkFrom(probeNearestLink(root)), { path: link, kind: "empty" });
    });
  });
});

describe("probeResolvedLink", () => {
  // The half of the chain probe that runs once `realpath` has answered. It used
  // to share that call's `try`, so a `stat` that failed landed in the handler
  // written to classify the FIRST syscall and the reader was handed an errno
  // attributed to a call that had already succeeded — a race whose only
  // artifact is the message, pointed at the wrong place.

  const REAL = "/checkout/node_modules";
  const throwing = (code: string) => (): fs.Stats => {
    throw Object.assign(new Error("boom"), { code });
  };

  it("reports a `stat` failure against `stat`, not against the `realpath` that succeeded", () => {
    for (const code of ["EACCES", "ELOOP", "ENAMETOOLONG"]) {
      assert.deepEqual(
        probeResolvedLink(REAL, throwing(code)),
        { real: null, unreadable: { path: REAL, detail: code, syscall: "stat" }, obstruction: null },
        `${code} from the stat is attributed to the wrong syscall, or dropped entirely`,
      );
    }
  });

  it("says nothing when the target vanished between the two calls", () => {
    // The same race, ending the other way: `realpath` resolved and the path is
    // gone by the time `stat` looks. Absent is then the truth as of the second
    // observation, and it is what every ancestor of every checkout looks like —
    // a finding here would fire constantly and mean nothing.
    for (const code of ["ENOENT", "ENOTDIR"]) {
      assert.deepEqual(
        probeResolvedLink(REAL, throwing(code)),
        { real: null, unreadable: null, obstruction: null },
        `${code} from the stat produced a finding for a path that is simply no longer there`,
      );
    }
  });

  it("defaults to the real stat, and tells a directory from a file", () => {
    // The parameter exists for the rows above; a default that had drifted to a
    // stub would make all of them a test of the test. Both answers in one case,
    // because they are the two the walk actually branches on.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resolved-link-"));
    try {
      const dir = path.join(root, "node_modules");
      const file = path.join(root, "not-a-dir");
      fs.mkdirSync(dir);
      fs.writeFileSync(file, "");
      assert.deepEqual(probeResolvedLink(dir), {
        real: dir,
        unreadable: null,
        obstruction: null,
      });
      assert.deepEqual(probeResolvedLink(file), {
        real: null,
        unreadable: null,
        obstruction: { path: file, kind: "not-directory" },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the syscall implication table", () => {
  // Three syscalls report the same errno for three different problems, and the
  // path printed beside it is the link in every case. Until the syscall was
  // carried, an `EACCES` from `lstat` — which reads the link's PARENT — told
  // the reader to fix the link, which is the one directory that may be
  // perfectly fine.

  it("still carries one implication per syscall the probes can blame", () => {
    assert.deepEqual(Object.keys(SYSCALL_IMPLICATION).sort(), ["lstat", "realpath", "stat"]);
  });

  it("reads as a clause the parenthesis can hold", () => {
    assertPhraseTable(SYSCALL_IMPLICATION, {
      renderedIn: (Object.keys(SYSCALL_IMPLICATION) as (keyof typeof SYSCALL_IMPLICATION)[]).map(
        (syscall) => unreadableList([{ path: "/checkout/node_modules", detail: "EACCES", syscall }]),
      ),
      // Rendered after an em-dash inside `(<detail> on <syscall> — <clause>)`,
      // so a row opens with its subject rather than with punctuation.
      opens: /^[a-z]/,
      // Inside a parenthesis the sentence continues past, so a period anywhere
      // closes it early — and nothing here names a dotted file.
      periods: "never",
      template: "<path> (<detail> on <syscall> — <implication>)",
    });
  });

  it("sends the reader to a different directory for each syscall", () => {
    // The whole reason the syscall is carried: `realpath` implicates the link,
    // `lstat` implicates its parent, and `stat` implicates neither — it says
    // the link resolved and then stopped answering. A table whose rows differed
    // only in wording would print three sentences and give one instruction.
    assert.match(SYSCALL_IMPLICATION.realpath, /link itself/);
    assert.match(SYSCALL_IMPLICATION.lstat, /PARENT/);
    assert.match(
      SYSCALL_IMPLICATION.lstat,
      /may be fine/,
      "the `lstat` row does not say the link may be innocent, which is the misdirection it exists to undo",
    );
    assert.match(SYSCALL_IMPLICATION.stat, /resolved/);
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

  // Real `fs.Stats`, taken once from a planted symlink and a planted file,
  // rather than an object answering the one method the probe happens to call
  // today. The seam asks for the whole shape on purpose — a stub that answers
  // `isSymbolicLink` and nothing else compiles until the probe reads a second
  // field and then throws `is not a function` on every row at once — and these
  // are the cheapest honest way to supply it.
  const STATS = (() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "absent-link-stats-"));
    try {
      fs.symlinkSync(path.join(root, "gone"), path.join(root, "link"));
      fs.writeFileSync(path.join(root, "file"), "");
      return {
        symlink: fs.lstatSync(path.join(root, "link")),
        file: fs.lstatSync(path.join(root, "file")),
      };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  })();

  const asSymlink = (isLink: boolean) => () => (isLink ? STATS.symlink : STATS.file);
  const throwing = (error: unknown) => (): fs.Stats => {
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
        { unreadable: { path: LINK, detail: code, syscall: "lstat" }, obstruction: null },
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
