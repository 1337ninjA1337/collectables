/**
 * Scratch scan roots for the `LINT_GUARDS` fleet, in the two shapes the
 * floor's two failure codes need.
 *
 * `__tests__/lint-guard-empty-root.test.ts` builds the first shape by hand —
 * one `os.tmpdir()` directory, nothing in it — and every guard pointed at it
 * fails on `no_files`. That is the LOUD version of the failure and the one the
 * floor was never really for: `evaluateScannedFloor` already refused
 * `count <= 0` before any floor existed. The number in `SCANNED_FLOORS` buys
 * the QUIET version — a walk that lost `app/` but kept `lib/` reports a
 * comfortable-looking count over a fraction of the tree — and `below_floor`
 * had never been produced by anything but a hand-edit.
 *
 * A partial root is the empty one plus a copy of part of this repository, so
 * the walk finds real files and finds too few of them.
 *
 * COPIES, not symlinks. A symlinked scan root works for the guards that walk
 * `path.join(root, "app")` directly (`readdirSync` follows the path it is
 * given) and silently produces ZERO files for the ones that enumerate the root
 * itself — `check-secrets` reads the top level with `withFileTypes` and a
 * symlink answers `isDirectory() === false`, so it is skipped, and the fixture
 * that was supposed to assert `below_floor` asserts `no_files` instead while
 * looking like it worked. The copies are small (the largest fixture here is
 * `app/`, ~400K) and they cannot lie about their own entry type.
 *
 * Lives under `__tests__/helpers/` — outside the `__tests__/*.test.ts` runner
 * glob, so it is a library, not a suite.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import { GUARD_ROOT_ENV } from "../../lib/guard-root";
import type { LintGuard } from "../../lib/lint-guards";
import { describeThrown } from "../../lib/thrown-value";

import { REPO_ROOT, repoPath } from "./repo-file";

/**
 * The loader every guard in every one of these suites is spawned through.
 *
 * `node --import tsx <script>` rather than `node_modules/.bin/tsx <script>`,
 * and the difference is not cosmetic: the `tsx` bin is a WRAPPER that spawns
 * its own node child. `execFileSync` gives that child the same stdout pipe, so
 * a `timeout` that kills the wrapper leaves the grandchild holding the write
 * end open, the parent's read never sees EOF, and the call hangs anyway — the
 * timeout below would be decoration. One process, no grandchild, and the
 * ~430 ms wrapper boot goes with it.
 */
const TSX_SPECIFIER = "tsx";

/**
 * The resolver the check below asks, rather than the filesystem.
 *
 * `createRequire` is bound to this file only so the returned `resolve` exists;
 * every call passes `paths` explicitly, which replaces the resolution roots, so
 * the answer is about the checkout named in the argument and not about where
 * this helper happens to live.
 *
 * With one exception, which is why {@link resolvedFromCheckout} exists: `paths`
 * replaces them "with the exception of GLOBAL_FOLDERS", so `$NODE_PATH` and
 * `~/.node_modules` answer for a checkout that has no install of its own.
 */
const resolver = createRequire(__filename);

/**
 * A `path` namespace — `path` itself, or `path.win32` / `path.posix`.
 *
 * Spelled as the type of one of them rather than as `path.PlatformPath`, which
 * this repository's `@types/node` does not export under a namespace import.
 */
type PathNamespace = typeof path.posix;

/**
 * A chain, typed as what it always is: some links, then the filesystem root's.
 *
 * The tuple is the whole point. Three call sites read the first entry as "the
 * nearest link" and each was a bare `chain[0]` whose correctness came from a
 * sentence in {@link nodeModulesChain}'s doc comment — a reordering there
 * (sorting, de-duplicating, dropping roots) would have made all three wrong
 * with nothing to catch it. Saying it in the type puts the claim where the
 * readers are, and a `[…, string]` still gives them a `chain[0]` that is a
 * string rather than a maybe.
 *
 * The rest comes FIRST and the guaranteed link comes last, which is the shape
 * of the argument rather than a shape chosen to be convenient: what makes a
 * chain non-empty is that the walk ends at the filesystem root and that root's
 * link is always pushed. Written as `[string, ...string[]]` the same guarantee
 * has to be re-established after the fact — by a check the caller cannot reach
 * or by a cast — and that is a branch this file has now deleted three times
 * over for being unreachable.
 */
export type ChainLinks = readonly [...string[], string];

/**
 * Whether node would refuse to search from inside this directory.
 *
 * One home for the test both readers of the chain make. {@link
 * nodeModulesChain} skips such a directory and {@link nearestChainLink} climbs
 * out of it, which is the same rule serving two derivations that are compared
 * against each other — and while each spelled it `path.basename(dir) ===
 * "node_modules"` for itself, the comparison looked like it checked the rule
 * and could only ever check that the two copies had not drifted apart. They
 * cannot drift now, and what the comparison is left checking is the part worth
 * checking: that a climb and a skip agree about where the nearest link is.
 *
 * The shared assumption stays shared, which is the honest outcome — a directory
 * genuinely NAMED `node_modules` that is not one is invisible to both, and
 * nothing in this file can tell the difference. Naming it at least gives that
 * assumption one place to be found.
 */
export function isNodeModulesDir(dir: string, p: PathNamespace = path): boolean {
  return p.basename(dir) === "node_modules";
}

/**
 * The `node_modules` directories node searches for a bare specifier from
 * `root`, nearest first.
 *
 * `root/node_modules`, then every ancestor's, which is both what CJS walks and
 * what the ESM resolver walks — a hoisted install one directory up is a real
 * install and the spawn loads it. What is NOT in this list is the set node
 * calls GLOBAL_FOLDERS (`$NODE_PATH`, `~/.node_modules`, `$PREFIX/lib/node`):
 * `require.resolve` still consults those after the chain, and the ESM resolver
 * never does.
 *
 * Directories already inside a `node_modules` are skipped, the same way node
 * skips them.
 *
 * There is ALWAYS at least one link, which is why the return type says so and
 * why three functions here stopped carrying an "empty chain" branch. The walk
 * climbs until `dirname` stops moving, and that last directory — the filesystem
 * root — has its link appended UNCONDITIONALLY, outside the loop and without
 * consulting {@link isNodeModulesDir}. That is what makes the guarantee
 * structural, and it is why this half survived a discovery the climb in
 * {@link nearestChainLink} did not: the premise both were written on, that a
 * filesystem root's basename is `""` and so never `node_modules`, is false for
 * a Windows UNC root, where it is the share name. A chain rooted at
 * `\\server\node_modules\` is still one link long; a climb written to stop at
 * the first non-`node_modules` directory was still climbing.
 * The branch those functions carried was documented as "the root of a
 * filesystem", which is exactly the root that disproves it: `/` has a chain,
 * and it is `["/node_modules"]`.
 *
 * Exported so the two properties the readers depend on — nearest first, never
 * empty — are pinned by cases rather than by a doc comment nothing checks.
 *
 * `p` is the path namespace, defaulted, and it is a seam of exactly the kind
 * the syscalls here have: the claims both this and {@link nearestChainLink}
 * make are about "every platform node runs on", and a suite that runs on one of
 * them can otherwise only assert the platform it booted with. `path.win32` and
 * `path.posix` need no filesystem and no spawn, so the roots that disprove a
 * premise — a UNC share among them — are rows.
 */
export function nodeModulesChain(root: string, p: PathNamespace = path): ChainLinks {
  // Everything BELOW the filesystem root, nearest first. The loop stops one
  // directory short deliberately: the root's own link is the one the argument
  // above guarantees, so it is appended outside the loop where the guarantee
  // can be read, rather than pushed by an iteration and then re-established
  // afterwards by a check no caller can reach.
  const below: string[] = [];
  let dir = p.resolve(root);
  for (;;) {
    const parent = p.dirname(dir);
    if (parent === dir) break;
    if (!isNodeModulesDir(dir, p)) {
      below.push(p.join(dir, "node_modules"));
    }
    dir = parent;
  }
  return [...below, p.join(dir, "node_modules")];
}

/**
 * The nearest `node_modules` node would search from `root`.
 *
 * The chain's first entry, said once and in a name, because three places used
 * to spell it `chain[0]` and none of them said why that is the nearest. Two of
 * them have since been given the walk's own answer instead ({@link
 * ChainProvenance.nearest}); this is for the one caller that has no walk behind
 * it.
 *
 * Derived rather than read off the chain, which is the point. `return
 * nodeModulesChain(root)[0]` makes the case that checks the two against each
 * other a tautology — the same expression twice — so the rule this function
 * names would have had exactly as much defence as the doc comment it replaced.
 * Two statements that can disagree are what makes the comparison worth running:
 * a change to the chain walk that moved the nearest link now fails here rather
 * than silently redefining what "nearest" means for both readers at once.
 *
 * The climb is the one thing it shares with the walk: a root that IS a
 * `node_modules` has no link of its own, because node never searches inside one
 * — so `/a/node_modules` is nearest to `/a/node_modules`, not to
 * `/a/node_modules/node_modules`.
 *
 * It stops climbing at the FIXED POINT of `dirname` and not at a directory that
 * fails {@link isNodeModulesDir}, which reads like belt and braces and is the
 * difference between terminating and not. The premise this was written on — the
 * filesystem root's basename is `""`, so the loop always finds a non-`node_modules`
 * directory to stop at — holds for POSIX roots and for Windows drive roots and
 * is FALSE for a Windows UNC root: `path.win32.basename("\\\\server\\share\\")`
 * is `"share"`, and a share named `node_modules` is a legal share. `dirname` of
 * that root is the root, so the climb had nowhere to go and went there forever.
 * The fixed point is what "there is nothing above this" actually means, on
 * every platform, and it is the same test the chain walk stops on — which is
 * why the two still agree about such a root, both answering with a link under
 * it rather than one of them hanging.
 *
 * Returns a string rather than a maybe — see {@link nodeModulesChain} for why
 * there is always one.
 */
export function nearestChainLink(root: string, p: PathNamespace = path): string {
  let dir = p.resolve(root);
  while (isNodeModulesDir(dir, p)) {
    const parent = p.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return p.join(dir, "node_modules");
}

/** Whether `child` is inside `parent` — not equal to it, and not a sibling. */
function isUnder(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Which syscall produced an unreadable finding — and therefore WHICH directory
 * the reader has to fix.
 *
 * The three sources report the same errno for three different problems, and
 * until the syscall was carried the message printed `<path> (EACCES)` for all
 * of them with the link as the path. That sends a reader to `chmod` the thing
 * that is not the problem in two cases out of three: an `EACCES` from `realpath`
 * means the link itself cannot be traversed, and the same code from `lstat`
 * means its PARENT could not be read — the link may be perfectly fine.
 */
export type LinkSyscall = "realpath" | "stat" | "lstat";

/**
 * What a failure of each syscall implicates, in the one place that decides.
 *
 * Rendered inside `<path> (<detail> on <syscall> — <implication>)`, so each row
 * is a clause with no punctuation of its own; the shared phrase rulebook pins
 * exactly that.
 */
export const SYSCALL_IMPLICATION: Record<LinkSyscall, string> = {
  realpath: "the link itself could not be traversed",
  stat: "the link resolved and then could not be inspected, so something changed it mid-walk",
  lstat: "its PARENT directory could not be read, so the link itself may be fine",
};

/** A chain path the process could not resolve for a reason other than absence. */
type UnreadableLink = { path: string; detail: string; syscall: LinkSyscall };


/**
 * How a failed `realpath` should be reported, or null for plain absence.
 *
 * "It is not there" and "this process cannot look at it" are different
 * findings with different fixes, and collapsing both into `null` sends the
 * caller down the GLOBAL_FOLDERS path for an `EACCES` on a directory the
 * runner cannot traverse, an `ELOOP` on a symlink cycle or an `ENAMETOOLONG`
 * — a diagnosis that is wrong, and whose fix (`npm ci`) changes nothing.
 *
 * `ENOENT` and `ENOTDIR` are the ordinary answer for nearly every ancestor of
 * a checkout, so those stay silent; everything else is reported.
 *
 * An error carrying no `code` is reported in words rather than as a fabricated
 * one: printing `UNKNOWN` in the slot where every other case prints an errno
 * reads like a real filesystem code and sends the reader looking it up. What
 * fills that slot is {@link describeThrown}, so the value gets a rendering
 * whatever it turns out to be — see there for why `String(...)` is not enough.
 *
 * Exported because it is the whole classification and it is a pure function of
 * one argument — the cases that matter (a code that is not absence, the two
 * that are, an error with no code at all) are a table, and reaching them
 * through the filesystem would mean arranging three kernel states instead.
 */
export function describeResolveFailure(error: unknown): string | null {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return null;
  if (typeof code === "string" && code !== "") return code;
  return `no errno: ${describeThrown(error)}`;
}

/**
 * The shapes a chain path can take that cannot hold an install.
 *
 * A closed union rather than a free-text fragment written at the throw-adjacent
 * sites: the phrasing below is grammatical only because it was written to fit
 * the one template that renders it (`<path> (<phrase>)`, then "those paths are
 * in the chain node searches"), and a third shape added by someone reading only
 * the probe — a socket, a FIFO, a directory with no execute bit — would produce
 * a sentence that does not parse. With the kind closed, adding one is a
 * compile error until the phrase is written here, beside the two it has to read
 * like.
 */
export type ObstructionKind = "not-directory" | "dangling-link";

/**
 * How each kind is said, in the one place that decides.
 *
 * Every phrase is a verb phrase completing "<path> …", present tense, with no
 * trailing period — the clause supplies its own punctuation — and the tests
 * pin exactly that, so the table cannot grow a row that reads wrong in the
 * sentence it is dropped into. Exported so the cases that assert the message
 * read the phrase from here rather than retyping it: a reworded row should not
 * be able to leave a green suite asserting prose the fixture no longer prints.
 */
export const OBSTRUCTION_PHRASE: Record<ObstructionKind, string> = {
  "not-directory": "is not a directory",
  "dangling-link": "is a symlink whose target does not exist",
};

/**
 * Something occupying a chain path that cannot hold an install.
 *
 * Distinct from {@link UnreadableLink}, which is about not knowing: this walk
 * knows exactly what is there and knows node will skip it, so the refusal
 * stands. What the finding buys is the reason — otherwise the reader is told
 * their checkout has no install at a path their own `ls` shows occupied.
 */
type ChainObstruction = { path: string; kind: ObstructionKind };

/** What one chain path turned out to be. */
type ChainLink = {
  /** Its real path, or null when it is absent, occupied or unreadable. */
  real: string | null;
  /** Why it could not be read, when that is what happened. */
  unreadable: UnreadableLink | null;
  /** What is in the way, when something is. */
  obstruction: ChainObstruction | null;
};

/**
 * `fs.realpathSync(target)`, keeping the reason it failed and what is there.
 *
 * Two shapes reach the walk as a silent nothing and are worth one extra
 * syscall each, because both are a thing a person made rather than a state of
 * the machine.
 *
 * A chain link that is a FILE resolves perfectly well: `realpath` reports
 * `ENOTDIR` only when a path component SHORT of the last one is not a
 * directory, and every chain link is an ancestor directory plus the name
 * `node_modules`. So a stray file under that name — a botched `npm ci`, a
 * download that landed wrong — comes back as a clean success that then matches
 * nothing. One `statSync` on the answer, which is already realpathed, so there
 * is no second resolution and no symlink question left in it.
 *
 * A chain link that is a DANGLING SYMLINK fails with `ENOENT`, which the
 * classification treats as absence — correct for the ancestors of any
 * checkout, which simply have no `node_modules`, and wrong for this one: the
 * path exists, someone created it (`ln -s ../shared/node_modules`, target
 * since moved), and it is the reason the install the reader believes they
 * linked is not being found. `lstatSync` tells the two `ENOENT`s apart, and it
 * runs only in the branch where the answer was already "not there".
 */
function probeChainLink(target: string): ChainLink {
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch (error) {
    const detail = describeResolveFailure(error);
    if (detail !== null) {
      return {
        real: null,
        unreadable: { path: target, detail, syscall: "realpath" },
        obstruction: null,
      };
    }
    return { real: null, ...probeAbsentLink(target) };
  }
  return probeResolvedLink(real);
}

/**
 * What a chain link that RESOLVED turns out to be.
 *
 * Split out of the try above rather than sharing its catch, which is the bug
 * this replaces: both syscalls sat in one block, so a `stat` that failed landed
 * in the handler written to classify the FIRST call, and the reader was handed
 * an errno attributed to a syscall that had already succeeded. The window is a
 * race — a target removed between the two calls, a filesystem that answers
 * `realpath` and then refuses `stat` — and the message is the only artifact of
 * it, so pointing it at the wrong call is the whole cost.
 *
 * A `stat` reporting plain ABSENCE is the same race and gets no finding: the
 * path is genuinely gone as of the second observation, which is what "no
 * install here" means and what every ancestor of every checkout looks like.
 * Anything else is unreadable, tagged with the syscall so the sentence can say
 * the link resolved before it stopped answering.
 *
 * `stat` is a parameter, defaulted, for the same reason `lstat` is one on
 * {@link probeAbsentLink}: the race cannot be arranged from a test, and the
 * branch that reports it is worth more than one that exists only in the source.
 */
export function probeResolvedLink(
  real: string,
  stat: (path: string) => fs.Stats = fs.statSync,
): ChainLink {
  let stats: fs.Stats;
  try {
    stats = stat(real);
  } catch (error) {
    const detail = describeResolveFailure(error);
    if (detail === null) return { real: null, unreadable: null, obstruction: null };
    return { real: null, unreadable: { path: real, detail, syscall: "stat" }, obstruction: null };
  }
  if (stats.isDirectory()) return { real, unreadable: null, obstruction: null };
  return {
    real: null,
    unreadable: null,
    obstruction: { path: real, kind: "not-directory" },
  };
}

/** What an lstat of the link itself turned out to say. */
type AbsentLinkFinding = Pick<ChainLink, "unreadable" | "obstruction">;

/**
 * The finding for a path `realpath` called absent — a dangling symlink, an
 * lstat that failed for its own reason, or nothing at all.
 *
 * `lstat` rather than `exists`: the question is whether the LINK is there, and
 * every call that follows the link has already answered "no".
 *
 * The catch goes back through {@link describeResolveFailure} rather than
 * swallowing everything as "not there". `lstat` reads the PARENT directory, so
 * an `EACCES` there makes it throw for a link that may well exist, and
 * answering ordinary-absence to that is exactly the collapse the unreadable
 * finding was created to stop, one level down: the reader would be told their
 * checkout has no install when the truth is that this process could not look.
 * A non-absence code is routed into the unreadable list, where "cannot tell"
 * already has a sentence; `ENOENT`/`ENOTDIR` stay silent, which is what nearly
 * every ancestor looks like.
 *
 * `lstat` is a parameter, defaulted, purely so that catch has a table. The
 * interesting rows are an `EACCES` on the parent and an `ELOOP`, and neither
 * can be arranged through the filesystem here: these suites run as root in CI
 * containers (root traverses an unreadable directory), and every state a
 * non-root reader could arrange that `realpath` reports as a non-absence code
 * is answered by the branch above, before this one is reached.
 *
 * It returns `fs.Stats` rather than the one method this reads. A structural
 * `{ isSymbolicLink(): boolean }` is satisfied by the real syscall AND by a
 * two-line stub, which is the point of the seam — what it also allows is this
 * probe growing an `.isFile()` or a `.mode` check that compiles against `fs`
 * and throws `is not a function` on every injected row at once. Asking for the
 * whole shape costs the callers nothing real: a stub can be a `Stats` taken
 * from a planted path, which is a more honest fixture than an object that
 * answers one question.
 */
export function probeAbsentLink(
  target: string,
  lstat: (path: string) => fs.Stats = fs.lstatSync,
): AbsentLinkFinding {
  let link: fs.Stats;
  try {
    link = lstat(target);
  } catch (error) {
    const detail = describeResolveFailure(error);
    return {
      unreadable: detail === null ? null : { path: target, detail, syscall: "lstat" },
      obstruction: null,
    };
  }
  if (!link.isSymbolicLink()) return { unreadable: null, obstruction: null };
  return { unreadable: null, obstruction: { path: target, kind: "dangling-link" } };
}

/**
 * Whether the resolver's answer came out of the checkout's own dependency
 * chain rather than out of a global folder.
 *
 * Everything is compared REALPATHED, because `require.resolve` answers with a
 * real path and neither side of the comparison need be one: a root reached
 * through a symlinked ancestor (`/var` → `/private/var` on macOS) and an
 * install symlinked into the tree (pnpm, `npm link`, a workspace) are both
 * ordinary, and both would look like a global answer to a plain string prefix.
 *
 * So two places per chain link, and the second is why this is not a bare "is
 * the file under the root": the `node_modules` itself, and the package entry
 * inside it, whose realpath is where a symlinked install actually lives.
 *
 * What this deliberately does NOT do is take the EXISTENCE of a chain entry as
 * proof that the entry answered. The chain is searched first, so an entry that
 * resolves must have won — but one that does not (an empty `node_modules/tsx`
 * from an interrupted `npm ci`, a broken symlink, a manifest whose `main` was
 * never written) is skipped by the resolver, which then falls through to the
 * global folders and succeeds there. That combination — a half-written install
 * in the checkout and a good one on `$NODE_PATH` — is exactly the case this
 * check exists for, and an existence test waves it through.
 *
 * A link this process could not READ is reported rather than counted as a
 * miss, because "no" and "cannot tell" are different answers: the unreadable
 * link may be the very install the resolver loaded, so a bare `false` would
 * hand the reader the GLOBAL_FOLDERS sentence for a permissions problem.
 * Collected all the way along and returned even on success, so the caller
 * decides — a chain that contains the resolution has nothing left to explain.
 *
 * A link that is OCCUPIED — a file, a symlink pointing at nothing — is
 * collected too, and it is a different kind of finding from either: it is not
 * a reason to doubt the answer, because node skips it exactly as this walk
 * does. It is the reason the checkout has no install where it looks like it
 * has one, and without it the reader is told their checkout resolves through a
 * global folder while a `node_modules` sits right there in the listing.
 */
type ChainProvenance = {
  fromCheckout: boolean;
  unreadable: UnreadableLink[];
  /** Chain links occupied by something that cannot hold an install. */
  obstructed: ChainObstruction[];
  /**
   * The nearest chain link, exactly as this walk saw it.
   *
   * Carried out rather than re-probed by the message builder, which is what the
   * refusal used to do: the walk probes the nearest link to decide, and the
   * clause probed it again one syscall later with no memory of the answer. The
   * two can disagree — an install landing between them is what a slow `npm ci`
   * in another terminal produces — so the sentence could describe a state that
   * no longer held when the decision was made, which is the one thing a
   * diagnosis must not do.
   *
   * Never null. It used to be, "when the chain is empty, which the root of a
   * filesystem is" — and the root of a filesystem has a chain, so that branch
   * was for a state no root can be in. See {@link nodeModulesChain}.
   */
  nearest: ProbedLink;
};

/** A chain path and what probing it turned up. */
export type ProbedLink = { path: string; link: ChainLink };

function resolvedFromCheckout(root: string, resolved: string): ChainProvenance {
  const unreadable: UnreadableLink[] = [];
  const obstructed: ChainObstruction[] = [];
  const chain = nodeModulesChain(root);
  // The first entry, taken as the nearest because the chain's type says it is
  // one — rather than the `nearest ??= …` this replaces, which was correct only
  // because the loop happened to run nearest-first and said so nowhere. Probed
  // here and reused below, so the link that decides is the link the message
  // reports and neither costs a second syscall.
  const [nearestPath] = chain;
  const nearest: ProbedLink = { path: nearestPath, link: probeChainLink(nearestPath) };
  const answer = (fromCheckout: boolean): ChainProvenance => ({
    fromCheckout,
    unreadable,
    obstructed,
    nearest,
  });
  for (const [index, dir] of chain.entries()) {
    // The index, not `dir === nearestPath`: reusing the probe on a string match
    // is right only while no link appears in the chain twice, which is true, is
    // stated nowhere, and is exactly the property a normalisation or de-dup pass
    // would be added to guarantee. "The first iteration is the nearest one" is
    // what is meant and it cannot come apart.
    const link = index === 0 ? nearest.link : probeChainLink(dir);
    if (link.unreadable) {
      // The entry inside it is reached THROUGH this path, so it cannot answer
      // anything the directory could not; probing it would only repeat the
      // errno under a longer name.
      unreadable.push(link.unreadable);
      continue;
    }
    if (link.obstruction) {
      // Nothing lives under a file or behind a dangling link, so this one
      // answers nothing and the entry probe below would ask the same question
      // one name deeper.
      obstructed.push(link.obstruction);
      continue;
    }
    if (link.real === null) continue;
    if (isUnder(link.real, resolved)) return answer(true);
    const entry = probeChainLink(path.join(dir, TSX_SPECIFIER));
    if (entry.unreadable) {
      unreadable.push(entry.unreadable);
      continue;
    }
    if (entry.real !== null && isUnder(entry.real, resolved)) {
      return answer(true);
    }
  }
  return answer(false);
}

/**
 * The two ways the nearest `node_modules` can be there and hold no install.
 *
 * `empty` is the literal one. `no-packages` is the same failure wearing a hat:
 * npm writes `.package-lock.json` before it restores the store and leaves
 * `.bin`, `.cache`, `.modules.yaml` behind on a prune, so an interrupted
 * install commonly ends with a directory that is not empty by `readdirSync`
 * and still holds nothing node can load. Counting entries alone sends that
 * reader back to the refusal this finding exists to replace, with the extra
 * confusion of a message that explicitly declined to call the directory empty.
 *
 * A dotted name is the line, and it is node's line rather than a guess: a
 * package directory is the specifier, and every specifier node will resolve
 * from here is either a plain name or a `@scope` — never a leading dot.
 */
export type EmptyLinkKind = "empty" | "no-packages";

/**
 * How each kind is said, in the one place that decides.
 *
 * Extracted for the same reason {@link OBSTRUCTION_PHRASE} was: the cases that
 * assert this clause read the phrase from here, so a rewording either updates
 * its pins or fails them, rather than leaving a green suite asserting the
 * absence of prose the fixture stopped printing.
 *
 * Each row completes "<path> …" and is followed by ", so node had nothing to
 * search in it" — so no trailing punctuation and no capital, and the tests pin
 * exactly that.
 */
export const EMPTY_LINK_PHRASE: Record<EmptyLinkKind, string> = {
  empty: "is there and is empty",
  "no-packages":
    "is there and holds no packages, only bookkeeping entries such as `.package-lock.json` or `.bin`",
};

/**
 * Which refusal the empty-link clause is being appended to.
 *
 * The clause's tail used to be one sentence written for the absent-install
 * message and carried into the global-folder one by the same interpolation,
 * where it is simply false: "this refusal reads exactly like one for a checkout
 * with no `node_modules` at all" is precisely right above a message that opens
 * by failing to resolve, and wrong above one that opens by naming a path it
 * resolved through `$NODE_PATH` — which reads nothing like the absent case, as
 * its reader can see for themselves. A message that makes a checkable claim and
 * gets it wrong costs more than the sentence was buying.
 */
export type EmptyLinkHost = "absent-install" | "global-folder";

/**
 * What the finding means for each refusal it lands in, in the one place that
 * decides.
 *
 * Each row completes "… so node had nothing to search in it and <tail>" and is
 * followed by " — an interrupted `npm ci` …", so no trailing punctuation and no
 * capital, the same shape {@link EMPTY_LINK_PHRASE} rows have. Exported for the
 * same reason too: the cases assert the tail landed in the right message and
 * stayed out of the other, and neither pin should be able to survive a rewrite
 * of the prose it is about.
 */
export const EMPTY_LINK_TAIL: Record<EmptyLinkHost, string> = {
  "absent-install": "this refusal reads exactly like one for a checkout with no `node_modules` at all",
  "global-folder": "the global answer above won by default rather than on merit",
};

/** The nearest chain link, when it is there, readable, and holds no install. */
export type EmptyLink = { path: string; kind: EmptyLinkKind };

/**
 * Whether a `node_modules` entry is a name node could load a package from.
 *
 * The rule is node's own rather than a guess about npm: a package directory IS
 * the specifier, and every specifier node will resolve from here is either a
 * plain name or a `@scope` — never a leading dot. Which is why this excludes
 * npm's bookkeeping (`.package-lock.json`, `.bin`, `.cache`, `.modules.yaml`,
 * whatever the next version writes) without naming any of it, and why the
 * scoped case comes out right: `@scope` is neither a plain name nor a dotfile,
 * and a rule written as "no plain names" would tell a workspace whose only
 * installed dependencies are scoped that it holds no packages at all.
 *
 * Named and exported rather than left inline at its one call site, because it
 * is a claim about how node resolves and not an expression: stated once, it can
 * be read against the resolver's rules by the next person, and its interesting
 * rows (`@scope`, `.bin`, a plain name, the dot directories) are a table rather
 * than a filesystem fixture per shape.
 */
export function looksLikePackageEntry(entry: string): boolean {
  return !entry.startsWith(".");
}

/**
 * The nearest chain link when it is there, readable, and holds no install.
 *
 * The most common real version of "the install is not where you think": an
 * interrupted `npm ci`, a pruned store, a cleaned cache all leave the directory
 * behind with nothing loadable in it. The walk above cannot see this — it asks
 * only whether `tsx` is under each link, and such a directory answers that with
 * the same silence as a healthy one that simply lost a single package.
 *
 * The nearest link only. An ancestor's empty `node_modules` is somebody else's
 * project and says nothing about this checkout, and reporting one per ancestor
 * would bury the finding under the noise the classification already refuses to
 * make.
 *
 * `readdirSync` failing is not this function's finding: the link is then
 * unreadable, which has its own sentence and its own list, and answering here
 * as well would name the same path twice with two different explanations.
 *
 * Takes the link the WALK probed rather than a root to probe again. The clause
 * used to re-run `probeChainLink` on the same path one syscall after the walk
 * had, with no memory of the answer, so a refusal could describe a state that
 * no longer held when the decision was made.
 *
 * A `ProbedLink` and not a `ProbedLink | null`: there is no root without a
 * nearest link (see {@link nodeModulesChain}), so the null a caller could pass
 * was a state nothing could be in, and the case that covered it read as
 * coverage of the filesystem root while asserting something the filesystem root
 * does not do. "There is a link and it answered nothing" is still here, and it
 * is the `real === null` line below.
 *
 * `readdir` is injectable for the same reason the other syscalls are: the
 * failure branch above is a real decision — it declines to speak for a link
 * somebody else's finding owns — and as root in a CI container there is no way
 * to arrange it for real. Typed as the no-options overload it actually calls,
 * `fs.PathLike` included, so a row that stands in for the real syscall is
 * refused by the compiler in exactly the cases the real one would refuse.
 */
export function emptyLinkFrom(
  nearest: ProbedLink,
  readdir: (path: fs.PathLike) => string[] = fs.readdirSync,
): EmptyLink | null {
  if (nearest.link.real === null) return null;
  let entries: string[];
  try {
    entries = readdir(nearest.link.real);
  } catch {
    return null;
  }
  if (entries.length === 0) return { path: nearest.path, kind: "empty" };
  if (entries.some(looksLikePackageEntry)) return null;
  return { path: nearest.path, kind: "no-packages" };
}

/**
 * The nearest chain link, probed fresh.
 *
 * For the ONE refusal that has no walk behind it: when `require.resolve` itself
 * throws there is no provenance to carry the probe out of, so the message has
 * to ask. Every other caller passes the walk's own answer to
 * {@link emptyLinkFrom} instead.
 *
 * Exported because it is now the only reader of {@link nearestChainLink} and
 * the one place the two halves of the absent-install clause are joined; its
 * claim — the link named is the nearest one and the probe is of THAT path — was
 * previously reachable only by arranging a checkout `require.resolve` refuses.
 */
export function probeNearestLink(root: string): ProbedLink {
  const nearest = nearestChainLink(root);
  return { path: nearest, link: probeChainLink(nearest) };
}

/**
 * The clause saying the nearest `node_modules` is there and holds no install.
 *
 * Its own sentence rather than a row in {@link OBSTRUCTION_PHRASE}, because the
 * two findings end in opposite advice: something standing in a chain path has
 * to be REMOVED before anything can be installed there, and an empty directory
 * is the thing `npm ci` fills. Folding it into that table would produce "…
 * nothing can be installed there until it is removed" about the one directory
 * the reader must keep.
 *
 * Appended to the refusals whose finding is "this checkout has no install",
 * and deliberately not to the unreadable-link one: that refusal's whole point
 * is that the question could not be decided, and the nearest link is the one it
 * could not read, so this probe has nothing to add there but a second sentence
 * about the same path.
 *
 * Which of the two it is landing in has to be passed, because only the FINDING
 * is shared between them — what it means for the reader is not, and the tail
 * that says so was true of one message and false of the other for as long as
 * the two shared a sentence. See {@link EMPTY_LINK_TAIL}.
 *
 * Takes the finding rather than the root it was probed from, so it is pure and
 * exported: every row it can render — each kind against each host, and the
 * empty string for no finding at all — is then a table, where it used to cost a
 * planted directory and a spawned child per row. The probe stays with the
 * caller, which is the half that genuinely needs a filesystem.
 */
export function emptyLinkClause(empty: EmptyLink | null, host: EmptyLinkHost): string {
  if (empty === null) return "";
  return ` Note also: ${empty.path} ${EMPTY_LINK_PHRASE[empty.kind]}, so node had nothing to search in it and ${EMPTY_LINK_TAIL[host]} — an interrupted \`npm ci\`, a pruned store or a cleaned cache is what leaves that behind.`;
}

/**
 * The clause naming chain links something is standing in, or none at all.
 *
 * Appended to whichever refusal fires rather than replacing it: something in
 * the way does not make the answer uncertain — node skips it too, so the
 * refusal above it is right — it explains WHY the checkout has no install at a
 * path the reader can see in their own listing. Left out of the message
 * entirely, the two facts contradict each other on the reader's screen and the
 * sentence looks wrong.
 *
 * Empty for a healthy chain, which is the case that matters most: a clause
 * that shows up when nothing is wrong teaches the reader to skip the tail of
 * every message, including the one that names their actual problem.
 *
 * Pure and exported for the same reason {@link emptyLinkClause} is. "No
 * findings in, no clause out" is a one-row table, and it used to be proved by
 * spawning node twice with a planted `NODE_PATH` and a symlink cycle, because
 * the only way to reach the function was through a refusal. The spawns are
 * still worth paying where the claim needs them — that the clause reaches a
 * message a REAL walk produced — and nowhere else.
 */
export function obstructionClause(items: readonly ChainObstruction[]): string {
  if (items.length === 0) return "";
  const listed = items
    .map((item) => `${item.path} (${OBSTRUCTION_PHRASE[item.kind]})`)
    .join(", ");
  const one = items.length === 1;
  return ` Note also: ${listed} — ${one ? "that path is" : "those paths are"} in the chain node searches and cannot hold an install, so node skipped ${one ? "it" : "them"}; nothing can be installed there until ${one ? "it is" : "they are"} removed.`;
}

/**
 * The links a walk could not read, each with the errno, the call that produced
 * it, and which directory that call implicates.
 *
 * The syscall and its implication, not just the errno: the same `EACCES` means
 * "this link cannot be traversed" from `realpath` and "its PARENT could not be
 * read" from `lstat`, and the path printed is the link either way — so without
 * the attribution the reader is sent to `chmod` the one directory that is not
 * the problem.
 *
 * The third of the three clause builders, pure and exported like the other two,
 * so the rows of {@link SYSCALL_IMPLICATION} can be rendered without arranging
 * three kernel states that this suite cannot arrange at all.
 */
export function unreadableList(links: readonly UnreadableLink[]): string {
  return links
    .map(
      (link) =>
        `${link.path} (${link.detail} on ${link.syscall} — ${SYSCALL_IMPLICATION[link.syscall]})`,
    )
    .join(", ");
}

/**
 * Fail on the missing install rather than on its symptom.
 *
 * Spawning against an absent loader exits non-zero with no stdout and no
 * stderr, so `runGuardFrom` captures `""` and exit 1 — which is byte-for-byte
 * what a guard REFUSING looks like to these suites. Every assertion of the
 * form "this run failed" then passes for the wrong reason, and every assertion
 * of the form "this run passed" fails with a bare `1 !== 0` and no output to
 * explain it. Five suites depend on this; the diagnosis is worth one
 * resolution.
 *
 * RESOLVED, not `existsSync`-ed. The spawn below depends on node being able to
 * load `tsx` from `REPO_ROOT`, and a directory named `node_modules/tsx` is not
 * that: an interrupted `npm ci`, a pruned store or a half-restored cache all
 * leave the directory in place with the package's entry points missing, so the
 * path check passes and the spawn fails anyway — with the empty-pipes signature
 * the check exists to prevent, which is the one failure mode it must not let
 * through. `require.resolve` asks the question node will ask.
 *
 * Takes the checkout to look in rather than closing over `REPO_ROOT`, for the
 * same reason every other refusal here is reachable from a test: this one is
 * the diagnosis a fresh checkout gets, so "it names `npm ci`" should be a case
 * rather than a thing observed once by whoever forgot to install.
 */
export function tsxLoaderIn(root: string): string {
  let resolved: string;
  try {
    resolved = resolver.resolve(TSX_SPECIFIER, { paths: [root] });
  } catch (error) {
    // The resolver's own first line, so a half-written install ("Cannot find
    // module 'tsx/dist/loader.mjs'") reads differently from an absent one —
    // the two want different fixes and the message is the only place the
    // reader can tell them apart. Through the shared renderer, because a
    // resolver hook (a loader, a patched `Module._resolveFilename`) can throw
    // anything at all, and this catch had its own copy of the rendering that
    // does not survive that.
    const reason = describeThrown(error);
    throw new Error(
      `guard-fixture: \`${TSX_SPECIFIER}\` does not resolve from ${root} (looked under ${path.join(root, "node_modules")}; ${reason}), so no guard can be spawned. Run \`npm ci\` — without it these suites fail with an empty output and a bare exit 1, which is indistinguishable from the refusals they are asserting.${emptyLinkClause(emptyLinkFrom(probeNearestLink(root)), "absent-install")}`,
    );
  }
  const provenance = resolvedFromCheckout(root, resolved);
  if (!provenance.fromCheckout && provenance.unreadable.length > 0) {
    // Not the global-folder finding, and it must not be printed as one: a link
    // this process cannot read may be exactly the install that answered, so
    // the honest report is "cannot tell", with the errno that stopped it and
    // WITHOUT `npm ci`, which is the one thing that will not help.
    const links = unreadableList(provenance.unreadable);
    throw new Error(
      `guard-fixture: \`${TSX_SPECIFIER}\` resolves from ${root} to ${resolved}, and whether that is the checkout's own install could not be decided: ${provenance.unreadable.length} of the \`node_modules\` directories node would search from that checkout could not be read — ${links}. That is not "this checkout has no install", and re-installing will not change it; a link that cannot be traversed (permissions), a symlink cycle or a path too long for the filesystem all land here, and any of them may be the install the resolver actually loaded. Fix the paths above, then re-run.${obstructionClause(provenance.obstructed)}`,
    );
  }
  if (!provenance.fromCheckout) {
    // The walk's own nearest link, not a second `nodeModulesChain(root)[0]`
    // beside it: the same path arrived at twice is how the two halves of one
    // sentence come to disagree, and the clause at the end of this message
    // already reports on THIS link. Naming a different one in the opening would
    // be the sharpest version of that.
    throw new Error(
      `guard-fixture: \`${TSX_SPECIFIER}\` resolves from ${root} to ${resolved}, which is under none of the \`node_modules\` directories node would search from that checkout (nearest: ${provenance.nearest.path}). \`require.resolve\` keeps GLOBAL_FOLDERS — \`$NODE_PATH\`, \`~/.node_modules\` — even when \`paths\` is passed, and the spawn below is \`node --import ${TSX_SPECIFIER}\`, an ESM resolution, which consults none of them. Run \`npm ci\` in that checkout — a globally installed loader answers this check and not the spawn, which then fails with an empty output and a bare exit 1, indistinguishable from the refusals these suites are asserting.${emptyLinkClause(emptyLinkFrom(provenance.nearest), "global-folder")}${obstructionClause(provenance.obstructed)}`,
    );
  }
  // The bare specifier, not the file the resolver answered with: node resolves
  // `--import tsx` against `cwd` (REPO_ROOT below) through the package's own
  // exports map, and the CJS resolution above may well name a different entry
  // than the `import` condition the spawn gets. Presence is the question here.
  return TSX_SPECIFIER;
}

/** {@link tsxLoaderIn} against the checkout the guards are actually spawned from. */
function tsxLoader(): string {
  return tsxLoaderIn(REPO_ROOT);
}

export type PartialRoot = {
  /** Absolute path of the scratch root, for `LINT_GUARD_REPO_ROOT`. */
  readonly root: string;
  /** Removes it. Safe to call twice. */
  readonly cleanup: () => void;
};

/**
 * A temp directory holding copies of `entries` (repo-relative files or
 * directories) at the same relative paths, plus any literal `files`, and
 * nothing else.
 *
 * Every parent directory is created for real, so a nested entry such as
 * `supabase/migrations` yields a real `supabase/` a top-level walk descends
 * into rather than skipping.
 *
 * `files` is the half `entries` cannot express: the `empty_input` failure is
 * about a declared input that reads and parses FINE and carries nothing
 * (`{}`, `""`), and no path in this repository is that file. A literal is the
 * only way to hand a guard one.
 *
 * A `Buffer` value plants BYTES rather than text, which is what an archive
 * fixture needs — `check-secrets` opens `.pbit` files now, and the offender it
 * has to be pointed at is a zip. Written without an encoding in that case,
 * since naming one for a Buffer is how a fixture quietly becomes UTF-8.
 */
export function makePartialRoot(
  entries: readonly string[],
  files: Readonly<Record<string, string | Buffer>> = {},
): PartialRoot {
  if (entries.length === 0 && Object.keys(files).length === 0) {
    throw new Error(
      "makePartialRoot: a partial root with no entries and no files is an EMPTY root — use the empty-root harness, which asserts the other failure code.",
    );
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lint-guard-partial-"));
  // Every refusal below happens AFTER the scratch directory exists, so each one
  // has to take it back down again: a suite that asserts a bad spec is refused
  // would otherwise leave a directory in `os.tmpdir()` per assertion, and the
  // leak is invisible because the throw it rides on is the expected outcome.
  try {
    for (const entry of entries) {
      if (path.isAbsolute(entry)) {
        throw new Error(
          `makePartialRoot: "${entry}" must be repo-relative — an absolute path would copy from outside this checkout.`,
        );
      }
      const source = repoPath(entry);
      if (!fs.existsSync(source)) {
        throw new Error(
          `makePartialRoot: "${entry}" does not exist in this repository, so the fixture would be empty and the guard would fail on the wrong code.`,
        );
      }
      const destination = path.join(root, entry);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true, dereference: true });
    }
    for (const [relative, content] of Object.entries(files)) {
      if (path.isAbsolute(relative)) {
        throw new Error(
          `makePartialRoot: "${relative}" must be a path inside the scratch root, not an absolute one.`,
        );
      }
      const destination = path.join(root, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (Buffer.isBuffer(content)) fs.writeFileSync(destination, content);
      else fs.writeFileSync(destination, content, "utf8");
    }
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** The second half of a git fixture: what is in it that `.gitignore` forbids. */
export type GitRootOptions = {
  /**
   * Paths to commit past the ignore rules, `git add -f` style.
   *
   * The one shape this helper existed for and did not cover. `git add -f`
   * beats `.gitignore`, which is the only way a file the `.local.` convention
   * skips can also be a COMMITTED credential — so it is the fixture every
   * suite asserting that refusal needs, and two of the three call sites went
   * back to spawning git by hand to build it. A helper that covers the easy
   * half and leaves the interesting half copied is the duplication it was
   * meant to remove, one step along.
   *
   * Paths are relative to `root` and must already exist: `git add -f` on a
   * missing path fails with git's own wording, inside a fixture, which is
   * exactly the mystery {@link initGitRoot} refuses to hand a reader.
   */
  readonly forceAdd?: readonly string[];
};

/**
 * The failure of a fixture, distinguishable from the failure of a guard.
 *
 * `initGitRoot` used to call `assert.equal` on git's exit status, so "the
 * scratch repository could not be built" arrived in the output as an assertion
 * inside whichever case happened to build it — indistinguishable, at a glance,
 * from the guard under test doing the wrong thing. A described throw says
 * which of the two happened before the reader starts reading git's stderr.
 */
export class GitFixtureError extends Error {
  constructor(message: string) {
    super(`initGitRoot: ${message}`);
    this.name = "GitFixtureError";
  }
}

/**
 * Turn a scratch root into a git work tree whose only commit is `.gitignore`
 * plus whatever `forceAdd` names.
 *
 * `check-secrets` takes its candidates from `git ls-files` when git can answer
 * and from a walk when it cannot, so "is this fixture a repository?" became a
 * property a case chooses rather than an accident of `os.tmpdir()`. Three
 * suites had written these six lines out within a day of each other, which is
 * the count at which a shape stops being a coincidence — and the copies were
 * already free to differ on the one thing that matters (whether the ignore file
 * is COMMITTED, which decides whether `--exclude-standard` honours it in a
 * repository with no HEAD).
 *
 * Identity is set explicitly rather than inherited: `git commit` fails outright
 * on a machine with no `user.email` configured, which is most CI images, and
 * that failure would arrive as a mystery inside an unrelated assertion.
 *
 * `-c init.defaultBranch` keeps the hint off stderr — a guard suite that greps
 * a run's output should not have to filter git's advice out of it.
 *
 * Everything that can go wrong here throws a {@link GitFixtureError}, because
 * a fixture that could not be built and a guard that answered wrongly are two
 * different pieces of news and a bare `assert.equal` reports them as one.
 */
export function initGitRoot(root: string, ignore: string, options: GitRootOptions = {}): void {
  const git = (...args: string[]): void => {
    const run = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    // `run.error` and a non-zero status are two different failures and the old
    // check saw one of them: a missing binary or an unusable `cwd` leaves
    // `status` null, which reads as `null !== 0` and says nothing about why.
    if (run.error) {
      throw new GitFixtureError(`\`git ${args.join(" ")}\` could not be run in ${root}: ${run.error.message}`);
    }
    if (run.status !== 0) {
      const stderr = (run.stderr ?? "").trim();
      throw new GitFixtureError(
        `\`git ${args.join(" ")}\` exited ${String(run.status)} in ${root}: ${stderr || "(no stderr)"}`,
      );
    }
  };
  const forceAdd = options.forceAdd ?? [];
  for (const relative of forceAdd) {
    if (path.isAbsolute(relative)) {
      throw new GitFixtureError(
        `"${relative}" must be a path inside the scratch root, not an absolute one.`,
      );
    }
    if (!fs.existsSync(path.join(root, relative))) {
      throw new GitFixtureError(
        `"${relative}" does not exist under ${root}, so \`git add -f\` would fail with git's wording instead of this one. Write the file before initialising the repository.`,
      );
    }
  }
  git("-c", "init.defaultBranch=main", "init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "guard fixture");
  fs.writeFileSync(path.join(root, ".gitignore"), ignore, "utf8");
  git("add", ".gitignore");
  // `-f`, and in the same commit as `.gitignore`: the point of these paths is
  // that an ignore rule covers them, so a plain `add` would silently take none
  // of them and leave a fixture that proves the opposite of what it was built
  // for.
  if (forceAdd.length > 0) git("add", "-f", "--", ...forceAdd);
  // Committed, not merely written: `--exclude-standard` reads `.gitignore` from
  // the working tree, but a repository with no commit at all is a shape half
  // these guards have never seen, and a fixture should not be the place that
  // discovers what git does there.
  git("commit", "-qm", "fixture");
}

/** How a fixture rewrites one file of the copied checkout. */
export type RepoPatches = Readonly<Record<string, (source: string) => string>>;

/**
 * The line every guard run out of a {@link makeSharedPatchedRepo} copy prints
 * before it does anything else.
 *
 * A patched fixture's whole claim is "the COPY ran". Exit 0 does not establish
 * that: a bug that resolved the script path against the real checkout instead
 * of the copy's root would produce the same green, and would make every case
 * in the file silently exercise the committed table. The marker is a sentence
 * the real checkout cannot say, so provenance becomes a thing each case can
 * assert rather than a thing the fixture asks to be believed.
 */
export const PATCHED_REPO_MARKER = "patched-repo copy speaking";

/** The file the marker is injected into — imported by every guard wrapper. */
const MARKER_MODULE = "lib/scanned-floor.ts";

export type SharedPatchedRepo = {
  /** Absolute path of the copied checkout, for `scriptRoot`. */
  readonly root: string;
  /**
   * Applies `patches`, runs `guard` against `scanRoot`, restores the copy.
   * `label` identifies the patch in the run memo — see {@link runGuardWith}.
   */
  readonly runPatched: (
    label: string,
    patches: RepoPatches,
    guard: LintGuard,
    scanRoot: string,
  ) => GuardRun;
  /** Removes the copy. Safe to call twice. */
  readonly cleanup: () => void;
};

/**
 * ONE copy of the parts of this repository a guard needs to RUN, rewritten per
 * case and restored afterwards.
 *
 * The other fixtures here move what a guard LOOKS AT. This one moves what a
 * guard IS, which is the only way to produce `invalid_floor` and the nine
 * other `SCANNED_FLOORS` problem codes: those are findings about the guard's
 * own declaration, so the committed table has to be wrong for them to fire,
 * and the committed table is — correctly — never wrong. Copy `lib/` and
 * `scripts/`, patch the table in the copy, run the copy.
 *
 * Copied ONCE, not per case. Each copy is ~200 files, and a harness that grows
 * a copy per problem code pays that ~10 times over to assert ten one-line
 * declarations. `runPatched` writes the patch, spawns, and writes the pristine
 * bytes back, so a case costs a couple of `writeFileSync` calls instead of a
 * recursive copy. The restore is unconditional — a case that threw mid-run
 * would otherwise leave its patch in place and hand the NEXT case a copy that
 * is broken in a way its own patch never mentions.
 *
 * `lib/` and `scripts/` are enough because every guard wrapper reaches its
 * dependencies through relative imports; the tsx loader and `node_modules`
 * stay in the real checkout, resolved from the absolute paths
 * {@link runGuardWith} passes.
 */
export function makeSharedPatchedRepo(
  entries: readonly string[] = ["lib", "scripts"],
): SharedPatchedRepo {
  const copy = makePartialRoot(entries);
  const markerTarget = path.join(copy.root, MARKER_MODULE);
  if (!fs.existsSync(markerTarget)) {
    copy.cleanup();
    throw new Error(
      `makeSharedPatchedRepo: ${MARKER_MODULE} is not in the copied entries (${entries.join(", ")}), so no run out of this copy could prove it came from the copy.`,
    );
  }
  // Injected once and never restored: it is the copy's identity, not a case's
  // patch. Top-level in a module every wrapper imports, so it lands before the
  // guard's own first line whichever guard is spawned.
  fs.writeFileSync(
    markerTarget,
    `console.error(${JSON.stringify(PATCHED_REPO_MARKER)});\n${fs.readFileSync(markerTarget, "utf8")}`,
    "utf8",
  );

  /** Pristine bytes per patched file, captured the first time it is touched. */
  const pristine = new Map<string, string>();

  const applyPatches = (patches: RepoPatches): void => {
    for (const [relative, patch] of Object.entries(patches)) {
      const target = path.join(copy.root, relative);
      if (!fs.existsSync(target)) {
        throw new Error(
          `runPatched: "${relative}" is not in the copied entries (${entries.join(", ")}), so the patch would land nowhere.`,
        );
      }
      const source = fs.readFileSync(target, "utf8");
      if (!pristine.has(relative)) pristine.set(relative, source);
      const next = patch(source);
      if (next === source) {
        throw new Error(
          `runPatched: the patch for "${relative}" changed nothing — its anchor has drifted, and the fixture would run an UNPATCHED guard while claiming to run a broken one.`,
        );
      }
      fs.writeFileSync(target, next, "utf8");
    }
  };

  const restore = (): void => {
    for (const [relative, source] of pristine) {
      fs.writeFileSync(path.join(copy.root, relative), source, "utf8");
    }
  };

  return {
    root: copy.root,
    runPatched: (label, patches, guard, scanRoot) => {
      // `applyPatches` is INSIDE the try, not before it. It writes file by file
      // and refuses a patch whose anchor has drifted, so a multi-file patch can
      // throw with its earlier files already rewritten — and a throw before the
      // `finally` would hand the next case a copy that is broken in a way its
      // own patch never mentions. `pristine` is captured per file as it is
      // touched, so a partially applied patch restores exactly as far as it got.
      try {
        applyPatches(patches);
        return runGuardWith(guard, {
          scriptRoot: copy.root,
          scanRoot,
          label,
        });
      } finally {
        restore();
      }
    },
    cleanup: copy.cleanup,
  };
}

export type GuardRun = {
  /** stdout and stderr together — the refusal lands on stderr. */
  readonly output: string;
  readonly status: number;
};

const runs = new Map<string, GuardRun>();

/**
 * Ceiling on a single guard run, ~70x the ~430 ms a boot actually costs.
 *
 * `execFileSync` with no timeout waits forever, and forever inside a test
 * runner is a CI job that burns its whole limit with no output and no failing
 * assertion to point at — the worst possible shape for a harness whose entire
 * job is turning silence into a stated result. A guard that has not answered
 * in half a minute has not answered; the timeout turns that into a normal
 * captured failure the assertions can read.
 */
const GUARD_RUN_TIMEOUT_MS = 30_000;

/**
 * Guards print reports, and a report over a broken tree can be long. Node's
 * 1MB default would turn an overlong report into an ENOBUFS throw with the
 * output discarded, which reads as a crash rather than as the finding it is.
 */
const GUARD_RUN_MAX_BUFFER = 16 * 1024 * 1024;

export type GuardRunOptions = {
  /** Checkout the wrapper's SOURCE is read from. Defaults to this repository. */
  readonly scriptRoot?: string;
  /** Tree the guard WALKS, handed over as `LINT_GUARD_REPO_ROOT`. */
  readonly scanRoot?: string;
  /** Extra environment. Wins over `scanRoot` when it names the same variable. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Distinguishes two runs that agree on everything above and disagree on the
   * bytes at `scriptRoot` — the shared patched copy, rewritten per case.
   *
   * Without it the memo would answer the second case with the first case's
   * result, and the wrong answer would be a CACHE HIT rather than an error: a
   * green control would certify a patch that never ran.
   */
  readonly label?: string;
};

/**
 * A guard, run against a scratch root, memoised per
 * (scriptRoot, script, args, env, label) — every assertion about one run would
 * otherwise pay its own loader boot (~260 ms now that the `tsx` wrapper
 * process is gone; it was ~430 ms).
 *
 * Failure is the expected outcome here, so a non-zero exit is captured rather
 * than thrown: the exit code and the message are both things to assert.
 */
export function runGuardWith(
  guard: LintGuard,
  options: GuardRunOptions = {},
): GuardRun {
  const scriptRoot = options.scriptRoot ?? REPO_ROOT;
  const extraEnv: Record<string, string> = {
    ...(options.scanRoot === undefined
      ? {}
      : { [GUARD_ROOT_ENV]: options.scanRoot }),
    ...(options.env ?? {}),
  };
  // Every field that can change what comes back is in the key, sorted so two
  // equal environments cannot key differently by declaration order.
  const key = JSON.stringify({
    scriptRoot,
    scriptPath: guard.scriptPath,
    args: guard.args,
    env: Object.keys(extraEnv)
      .sort()
      .map((name) => [name, extraEnv[name]]),
    label: options.label ?? "",
  });
  const cached = runs.get(key);
  if (cached) return cached;
  const where = options.scanRoot ?? "the checkout it resolves for itself";
  // Resolved BEFORE the spawn, so its diagnostic is a throw the caller sees
  // rather than something folded into a captured failure — an absent loader
  // exits non-zero with nothing on either pipe, which is byte-for-byte what a
  // guard REFUSING looks like to these suites.
  const loader = tsxLoader();
  // `spawnSync`, not `execFileSync`, and the difference is one the harnesses
  // depend on: `execFileSync` RETURNS stdout, so on a green run stderr is
  // thrown away entirely. Guards print their premise notes there —
  // `guard-io.ts` announces a redirected root with `console.error` — so an
  // assertion about what a PASSING guard did or did not say was reading a
  // string the note could never have been in. "An ordinary run announces
  // nothing about the override" passed because the channel it would have been
  // announced on was discarded, not because nothing was announced.
  const result = spawnSync(
    process.execPath,
    ["--import", loader, path.join(scriptRoot, guard.scriptPath), ...guard.args],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
      timeout: GUARD_RUN_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: GUARD_RUN_MAX_BUFFER,
    },
  );
  let output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // A killed process reports `status: null`; failure is the expected outcome
  // here, so it is captured rather than thrown.
  const status = result.status ?? 1;
  const failure = result.error as (Error & { code?: string }) | undefined;
  if (failure?.code === "ETIMEDOUT" || result.signal === "SIGKILL") {
    // Say which run stalled and what it had managed to print. Without this the
    // assertions downstream see an empty output and exit 1, which is exactly
    // what a guard REFUSING looks like — the same confusion `tsxLoader()`
    // exists to prevent, arriving by a different door.
    output = `${output}\nguard-fixture: ${guard.scriptPath} (from ${scriptRoot}) did not finish within ${GUARD_RUN_TIMEOUT_MS}ms against ${where} and was killed. Everything it printed before that is above.`;
  } else if (failure) {
    // ENOBUFS and friends: the output is partial and the reason is not in it.
    output = `${output}\nguard-fixture: spawning ${guard.scriptPath} (from ${scriptRoot}) failed with ${failure.code ?? failure.message}.`;
  }
  const run = { output, status };
  runs.set(key, run);
  return run;
}

/**
 * A guard, run from this checkout against a scratch scan root — the shape the
 * empty-root, partial-root and empty-input harnesses all want.
 */
export function runGuardIn(guard: LintGuard, root: string): GuardRun {
  return runGuardWith(guard, { scanRoot: root });
}

/**
 * {@link runGuardIn} with the guard's own source root split out from the tree
 * it scans, so a copy patched by {@link makeSharedPatchedRepo} can be the
 * thing that runs while a real, complete tree is the thing it walks — leaving
 * the patched declaration as the only reason the run can fail.
 *
 * Prefer `SharedPatchedRepo.runPatched`, which carries the patch label the
 * memo needs; this is the unlabelled form, correct only while the bytes at
 * `scriptRoot` stay put for the whole suite.
 */
export function runGuardFrom(
  guard: LintGuard,
  scriptRoot: string,
  root: string,
): GuardRun {
  return runGuardWith(guard, { scriptRoot, scanRoot: root });
}

/**
 * A V8 stack frame, at the start of any line INCLUDING the first.
 *
 * Four harness suites need this and each had re-typed it: `/\n\s+at\s/` in one
 * (blind to a frame on line one, and to `at` in ordinary prose it is not blind
 * enough), `/^\s+at .+:\d+:\d+\)?$/m` in another. The `file:line:column` tail
 * is what makes it a frame rather than an English sentence, and both frame
 * shapes V8 emits — `at name (/path:1:2)` and the bare `at /path:1:2` — end in
 * it.
 */
const STACK_FRAME = /^\s*at\s+(?:\S.*\s+\()?\S*:\d+:\d+\)?\s*$/m;

/**
 * A premise failure is a RESULT, not a crash — and both exit 1, so the exit
 * code alone cannot tell them apart. Every guard harness asserts this; it is
 * one thing they cite rather than four paraphrases that can each be subtly
 * wrong.
 */
export function assertNoStackTrace(output: string, context = ""): void {
  assert.doesNotMatch(
    output,
    STACK_FRAME,
    `${context ? `${context}: ` : ""}crashed rather than refusing — a premise failure must print one line, not a stack:\n${output}`,
  );
}

/** Every `LINT_GUARDS` entry prints this at the head of its own report. */
export function checkNameOf(scriptPath: string): string {
  return scriptPath.replace(/^scripts\//, "").replace(/\.ts$/, "");
}

/** Where {@link entryPatch} looks for the table, and what its messages name. */
const ENTRY_TABLE_MODULE = "lib/scanned-floor.ts";

/**
 * Rewrites ONE `SCANNED_FLOORS` entry and leaves the rest of the module alone.
 *
 * Scoping the rewrite to the entry is what lets a case anchor on
 * `/minimum: 160/` instead of on a whole pretty-printed declaration: the key is
 * the anchor, and the key is a thing `lib/scanned-floor.ts` declares rather
 * than a thing a test remembers. `runPatched` refuses a patch that changed
 * nothing, so a rewrite whose regex stops matching fails loudly instead of
 * quietly running an unpatched guard.
 *
 * Lives here rather than in either harness because BOTH need it — the
 * malformed-declaration cases and the unanswerable-lookup ones patch the same
 * table the same way, and two copies of a parser are two things that have to
 * stay right about the same text.
 */
export function entryPatch(
  checkName: string,
  rewrite: (entry: string) => string,
): (source: string) => string {
  return (source) => {
    const open = `  "${checkName}": {`;
    const start = source.indexOf(open);
    assert.ok(start >= 0, `${checkName} has no entry in ${ENTRY_TABLE_MODULE}`);
    // Braces are counted from the opening one rather than scanning for the
    // first `\n  },`. No entry nests today, so the two agree — and the day one
    // does, the shortcut ends the slice early, the rewrite lands in the wrong
    // half, and `runPatched`'s no-op check waves it through because the patch
    // did change SOMETHING. The fixture's parse should be a fact about the
    // text, not an assumption about the table's current formatting.
    let depth = 0;
    let end = -1;
    for (let i = start + open.length - 1; i < source.length; i += 1) {
      const char = source[i];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    assert.ok(end > start, `${checkName}'s entry in ${ENTRY_TABLE_MODULE} never closes`);
    const entry = source.slice(start, end);
    const rewritten = rewrite(entry);
    assert.notEqual(
      rewritten,
      entry,
      `the rewrite for ${checkName} matched nothing in its entry — the anchor has drifted`,
    );
    return source.slice(0, start) + rewritten + source.slice(end);
  };
}
