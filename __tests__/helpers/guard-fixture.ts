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

/** The repository this fixture copies out of. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

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
 */
function nodeModulesChain(root: string): string[] {
  const chain: string[] = [];
  let dir = path.resolve(root);
  for (;;) {
    if (path.basename(dir) !== "node_modules") {
      chain.push(path.join(dir, "node_modules"));
    }
    const parent = path.dirname(dir);
    if (parent === dir) return chain;
    dir = parent;
  }
}

/** Whether `child` is inside `parent` — not equal to it, and not a sibling. */
function isUnder(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Whether the resolver's answer came out of the checkout's own dependency
 * chain rather than out of a global folder.
 *
 * Two ways to be satisfied, because a resolved path is REALPATHED and an
 * install need not be a plain directory:
 *
 * - the file lies under one of the chain's `node_modules`, the ordinary case;
 * - a `node_modules/<specifier>` entry exists on the chain. The chain is
 *   searched BEFORE the global folders, so if such an entry exists the
 *   successful resolution above necessarily came through it — which is how a
 *   symlinked or store-backed install (pnpm, `npm link`, a workspace) stays
 *   accepted even though its realpath lands outside the tree, and how a `root`
 *   reached through a symlinked ancestor (`/var` → `/private/var` on macOS)
 *   does too.
 */
function resolvedFromCheckout(root: string, resolved: string): boolean {
  return nodeModulesChain(root).some(
    (dir) => isUnder(dir, resolved) || fs.existsSync(path.join(dir, TSX_SPECIFIER)),
  );
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
    // reader can tell them apart.
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(
      `guard-fixture: \`${TSX_SPECIFIER}\` does not resolve from ${root} (looked under ${path.join(root, "node_modules")}; ${reason}), so no guard can be spawned. Run \`npm ci\` — without it these suites fail with an empty output and a bare exit 1, which is indistinguishable from the refusals they are asserting.`,
    );
  }
  if (!resolvedFromCheckout(root, resolved)) {
    const chain = nodeModulesChain(root);
    throw new Error(
      `guard-fixture: \`${TSX_SPECIFIER}\` resolves from ${root} to ${resolved}, which is under none of the \`node_modules\` directories node would search from that checkout (nearest: ${chain[0]}). \`require.resolve\` keeps GLOBAL_FOLDERS — \`$NODE_PATH\`, \`~/.node_modules\` — even when \`paths\` is passed, and the spawn below is \`node --import ${TSX_SPECIFIER}\`, an ESM resolution, which consults none of them. Run \`npm ci\` in that checkout — a globally installed loader answers this check and not the spawn, which then fails with an empty output and a bare exit 1, indistinguishable from the refusals these suites are asserting.`,
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
 */
export function makePartialRoot(
  entries: readonly string[],
  files: Readonly<Record<string, string>> = {},
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
      const source = path.join(REPO_ROOT, entry);
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
      fs.writeFileSync(destination, content, "utf8");
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
