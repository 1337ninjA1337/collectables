/**
 * The scan root every `LINT_GUARDS` wrapper walks, and the one env var that
 * can move it.
 *
 * `lib/scanned-floor.ts` gave all twelve guards a committed floor, and
 * `__tests__/lint-guard-premise.test.ts` runs all twelve — against a tree
 * where every one of them PASSES. Thirty-eight assertions, every one reading a
 * green run: the floors' whole value is in the failing case, and the failing
 * case had only ever been produced by hand-editing a script and reverting it.
 * A hand-verification that leaves no artifact is a thing that quietly stops
 * being true.
 *
 * The cheap way to run the failing case for real is the one the history guard
 * already uses: an env var that moves the root, pointed at an empty directory
 * under `os.tmpdir()`. One override, twelve reuses, and every floor gets a red
 * run in CI (`__tests__/lint-guard-empty-root.test.ts`).
 *
 * An env var that redirects a guard is also, read the other way, an env var
 * that could aim a guard at a tree where it passes vacuously — so:
 *
 * - the override must be an ABSOLUTE path. A relative one resolves against
 *   `cwd`, which differs between `npm run`, `lint:all` and a test spawn, so
 *   the same string would name three different roots.
 * - a guard running under an override SAYS SO, on every run, on stderr. A
 *   green line that came from a redirected root has to be distinguishable
 *   from a green line that came from this repository.
 *
 * Node-pure on purpose: imported by the tsx CLI wrappers and by node tests.
 */

import * as path from "node:path";

import { checkError } from "./check-error";

/** The shared override, honoured by every guard wrapper. */
export const GUARD_ROOT_ENV = "LINT_GUARD_REPO_ROOT";

/**
 * The history guard's older, narrower override. It stays because it moves
 * that guard's history half ONLY, and it keeps precedence over the shared one
 * so an existing invocation means exactly what it used to.
 */
export const PRIVACY_BASELINE_ROOT_ENV = "PRIVACY_BASELINE_REPO_ROOT";

export type GuardRootResolution = {
  /** The directory the guard should walk. */
  readonly root: string;
  /** Which env var supplied it, or null when it is the repository itself. */
  readonly source: string | null;
};

/** Thrown for an override this module refuses to honour. */
export class GuardRootError extends Error {
  readonly checkName: string;

  constructor(checkName: string, message: string) {
    super(checkError(checkName, message));
    this.name = "GuardRootError";
    this.checkName = checkName;
  }
}

/** `/tmp/empty/` and `/tmp/empty` are the same root; only one of them prints. */
function stripTrailingSeparator(value: string): string {
  if (value.length <= 1) return value;
  return value.endsWith(path.sep) ? value.slice(0, -1) : value;
}

/**
 * First variable in `vars` that carries a non-blank value wins; unset and
 * whitespace-only are both "not set", because `FOO= npm run lint:all` is how
 * an override gets un-set in practice and it should mean the default root.
 *
 * Pure: takes the env, returns the decision, throws only on an override it
 * cannot honour.
 */
export function resolveGuardRoot(
  checkName: string,
  defaultRoot: string,
  env: Readonly<Record<string, string | undefined>>,
  vars: readonly string[] = [GUARD_ROOT_ENV],
): GuardRootResolution {
  for (const name of vars) {
    const raw = env[name];
    if (raw === undefined || raw.trim().length === 0) continue;
    const value = raw.trim();
    if (!path.isAbsolute(value)) {
      throw new GuardRootError(
        checkName,
        `${name}="${value}" is not an absolute path. A relative root resolves against the current directory, which is not the same place for \`npm run\`, \`lint:all\` and a test spawn — so the same value would name three different trees.`,
      );
    }
    return { root: stripTrailingSeparator(path.normalize(value)), source: name };
  }
  return { root: defaultRoot, source: null };
}

/**
 * The line a guard prints when it is NOT looking at this repository — null on
 * the ordinary path, so a normal run stays exactly as quiet as it was.
 */
export function formatGuardRootNotice(
  checkName: string,
  resolution: GuardRootResolution,
): string | null {
  if (resolution.source === null) return null;
  return `${checkName}: NOTE — scan root overridden by ${resolution.source} to ${resolution.root}; this run says nothing about the repository it was launched from.`;
}
