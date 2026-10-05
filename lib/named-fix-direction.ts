/**
 * Whether the version `npm audit` names as a fix is ahead of the one installed.
 *
 * ## The sentence this exists to stop printing
 *
 * `check-audit-baseline`'s green line has said this on every run for a month:
 *
 * > npm offers no fix short of a semver-major for 8 advisories, cleared by 2
 * > upgrades: expo (7, up to high), expo-router (1, up to moderate)
 *
 * On 2026-10-05 the `fixAvailable` behind that `expo` group was
 * `{ name: "expo", version: "44.0.6", isSemVerMajor: true }`, and this tree is
 * on `expo@54.0.35`. Ten majors BACKWARD. The word "upgrades" was wrong, the
 * reader was being told an advisory could be cleared by moving forward, and
 * the same field said the same thing about `@sentry/react-native` (names
 * 5.15.2, installed 7.5.0) and `gh-pages` (names 6.1.1, installed 6.3.0 — and
 * `isSemVerMajor: true` on a move that is not even a major).
 *
 * ## Why npm says it, and why it is not a bug to route around
 *
 * `fixAvailable` answers "is there a version of a direct dependency whose tree
 * does not contain this advisory", and an old release qualifies: `expo@44`
 * predates the `@expo/metro` that carries the finding. npm is not claiming the
 * move is sensible, only that it resolves. `isSemVerMajor` then says the move
 * crosses a major, which is true of a downgrade too.
 *
 * So the field is honest and the gate's reading of it was not. A named fix is
 * one of three things and the gate owes the reader which:
 *
 * - **forward** — a real upgrade, which is what the line always claimed. This
 *   tree has four: `react-native@0.87.1`, `expo-router@58.0.13`,
 *   `expo-auth-session@57.0.13`, `expo-linking@57.0.11`.
 * - **backward** — npm found no forward fix and offered the past instead. Not
 *   an upgrade, not available, and nothing a contributor can act on; what it
 *   changes is the ACCEPTANCE, because "fix = a breaking major" and "npm has
 *   no forward fix at all" are different reasons to keep an exemption.
 * - **same** — npm names what is installed, which means the advisory is not in
 *   that version's tree by npm's own account and something else is wrong.
 *
 * ## Pure, and the installed version comes from the caller
 *
 * Same split as `lib/check-sentry-version.ts`: the wrapper reads
 * `package-lock.json` and hands the versions in. The lockfile rather than
 * `npm ls` because it is committed, so the answer is a fact about the
 * repository rather than about one machine's `node_modules`.
 */

/**
 * Compare two exact versions, or `null` when either is not one.
 *
 * Numeric on the dotted release part, with a prerelease sorting BELOW its own
 * release (`1.2.3-rc.1` < `1.2.3`) and otherwise compared as a string. That is
 * less than semver and deliberately so: nothing here resolves a RANGE, which
 * is where the real semver complexity lives, and the two inputs are an exact
 * version npm named and an exact version a lockfile resolved. A shape this
 * does not recognise comes back `null` rather than guessing — the direction
 * then reads `unknown`, which prints as "npm named X, the lockfile says Y" and
 * leaves the reader to look.
 */
export function compareVersions(a: string, b: string): number | null {
  const parsed = [a, b].map(parseVersion);
  const [left, right] = parsed;
  if (left === null || right === null) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left.release[i] !== right.release[i]) return left.release[i] - right.release[i];
  }
  if (left.pre === right.pre) return 0;
  // A release outranks any prerelease of itself; two prereleases fall back to
  // a string compare, which is right for `rc.1` vs `rc.2` and admitted to be
  // arbitrary for anything cleverer.
  if (left.pre === "") return 1;
  if (right.pre === "") return -1;
  return left.pre < right.pre ? -1 : 1;
}

interface ParsedVersion {
  readonly release: readonly [number, number, number];
  readonly pre: string;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(version.trim());
  if (!match) return null;
  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? "",
  };
}

/** Which way npm's named fix points, relative to what is installed. */
export type FixDirection =
  /** Ahead of the installed version — a real upgrade. */
  | "forward"
  /** Behind it. npm found no forward fix and offered the past. */
  | "backward"
  /** Exactly what is installed, which means something else is wrong. */
  | "same"
  /** One of the two is not an exact version, or the lockfile has no entry. */
  | "unknown";

/**
 * Which way a named fix points.
 *
 * `undefined` for `installed` is the lockfile having no entry for the package
 * npm named, which happens and is not an error: npm can name a package that
 * is only reachable as a transitive dependency under a different path. It
 * reads `unknown`, and the caller says so rather than inventing a direction.
 */
export function fixDirection(named: string, installed: string | undefined): FixDirection {
  if (installed === undefined) return "unknown";
  const order = compareVersions(named, installed);
  if (order === null) return "unknown";
  if (order > 0) return "forward";
  if (order < 0) return "backward";
  return "same";
}

/**
 * The version `package-lock.json` resolved for a package, or `undefined`.
 *
 * npm's lockfile v3 keys every install path, and the root install of a package
 * is `node_modules/<name>`. A nested copy (`node_modules/a/node_modules/b`) is
 * deliberately NOT consulted: the question is what a contributor's tree is on,
 * and a nested duplicate is a second answer to a question with one answer —
 * this tree has `react-native` at both 0.81.5 and a nested 0.86.0, which is
 * the dependency-tree finding `npm run bundle:native` fails on and exactly the
 * case where picking one silently would mislead.
 */
export function lockedVersion(lock: unknown, name: string): string | undefined {
  if (typeof lock !== "object" || lock === null) return undefined;
  const packages = (lock as { packages?: unknown }).packages;
  if (typeof packages !== "object" || packages === null) return undefined;
  const entry = (packages as Record<string, unknown>)[`node_modules/${name}`];
  if (typeof entry !== "object" || entry === null) return undefined;
  const version = (entry as { version?: unknown }).version;
  return typeof version === "string" && version !== "" ? version : undefined;
}

/** A named fix, read and placed against the tree. */
export interface NamedFixReading {
  /** The package npm would install. */
  readonly package: string;
  /** The version npm named. */
  readonly named: string;
  /** What `package-lock.json` resolved, if it has an entry. */
  readonly installed: string | undefined;
  readonly direction: FixDirection;
}

/** Read one named fix against a lockfile. */
export function readNamedFix(lock: unknown, name: string, named: string): NamedFixReading {
  const installed = lockedVersion(lock, name);
  return { package: name, named, installed, direction: fixDirection(named, installed) };
}

/**
 * What one reading says, as a sentence with no leading punctuation.
 *
 * Empty for `forward`, because that is the case the surrounding sentence
 * already states correctly and a line annotating the normal case is a line
 * nobody finishes reading. The other three each name BOTH versions, so a
 * reader can check the claim rather than take it.
 *
 * No leading separator, deliberately. The first version of this returned
 * `" — but npm names …"` and the caller had to strip that back off to put the
 * sentence on its own line; a formatter that owns its own punctuation is a
 * formatter with one caller.
 */
export function describeDirection(reading: NamedFixReading): string {
  switch (reading.direction) {
    case "forward":
      return "";
    case "backward":
      return `npm names ${reading.package}@${reading.named} and the lockfile is on ${String(reading.installed)}, which is BACKWARD — npm found no forward fix and offered an older tree, so this is not an upgrade anybody can take`;
    case "same":
      return `npm names ${reading.package}@${reading.named}, which is what the lockfile is already on, so the advisory is not where npm's fix verdict thinks it is`;
    case "unknown":
      return reading.installed === undefined
        ? `npm names ${reading.package}@${reading.named} and package-lock.json has no node_modules/${reading.package} entry, so which way it points is unread`
        : `npm names ${reading.package}@${reading.named} against a locked ${reading.installed}, and neither reads as an exact version, so which way it points is unread`;
  }
}
