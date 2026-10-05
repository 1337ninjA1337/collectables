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
 * What a committed claim about npm's named fix can be held to.
 *
 * Three states, read over the whole candidate SET rather than over npm's pick
 * of one — see the header for the eleven runs that established the pick is not
 * stable and the three that established the set is.
 */
export type NamedFixVerdict =
  /** At least one candidate is ahead of the lockfile — there is somewhere to go. */
  | "forward"
  /** Every candidate is at or behind it — no forward route by any path. */
  | "no-forward"
  /** npm named no candidate at all: a bare `true` fix, or no fix. */
  | "unnamed";

/**
 * The verdict over every candidate, or `null` when none could be read.
 *
 * **Any forward wins**, and that is the whole semantics: a question like "can
 * this tree move forward to clear the advisory" is answered yes by one route,
 * however many dead ends sit beside it. `braces` is the case — three backward
 * candidates and one forward — and reading it as `no-forward` is what an
 * acceptance said for a day.
 *
 * An unreadable candidate is SKIPPED rather than fatal: npm can name a package
 * the lockfile has no root entry for, and one such candidate must not withhold
 * a verdict the other three agree on. `null` is every candidate unreadable, or
 * the set being empty of readable ones while not being empty — which the
 * caller reports as "not checked" rather than treating as agreement.
 *
 * An empty set is `"unnamed"`: npm named nobody, which is a decided answer and
 * the state `image-size`'s bare `true` is in.
 */
export function verdictAcross(readings: readonly NamedFixReading[]): NamedFixVerdict | null {
  if (readings.length === 0) return "unnamed";
  const readable = readings.filter((reading) => reading.direction !== "unknown");
  if (readable.length === 0) return null;
  // `same` joins `backward`: npm naming what is already installed is npm
  // offering nowhere to go, which is what the verdict is about. The two are
  // still named separately by `describeReadings`, because "npm names your own
  // version" is a different thing to go and look at from "npm names an older
  // one".
  return readable.some((reading) => reading.direction === "forward") ? "forward" : "no-forward";
}

/**
 * A group of candidates in one compact sentence, or `""` when one is ahead.
 *
 * One formatter for one candidate and for four. The version before this spelled
 * a reading out in full and the caller applied it per candidate, which gave a
 * group of four four copies of one paragraph — and the ternary that avoided
 * that was also the one-versus-many comparison `lib/plural.ts` owns. This
 * names each candidate once and says the conclusion once, at either size.
 *
 * Empty for a group with a forward candidate: the surrounding sentence already
 * states the normal case, and a line annotating it is a line nobody finishes.
 */
export function describeReadings(readings: readonly NamedFixReading[]): string {
  if (readings.length === 0) return "";
  if (verdictAcross(readings) === "forward") return "";
  const placed = readings.filter((reading) => reading.direction !== "unknown");
  if (placed.length === 0) {
    // Named per candidate, because the two ways a reading can be unplaceable
    // are different things to go and look at: a lockfile with no root entry
    // for the package, and a version string nothing here parsed.
    const why = readings
      .map((reading) =>
        reading.installed === undefined
          ? `${reading.package}@${reading.named} has no node_modules/${reading.package} entry in package-lock.json`
          : `${reading.package}@${reading.named} against a locked ${reading.installed}, neither an exact version`,
      )
      .join(", ");
    return `the lockfile placed no candidate npm names, so which way they point is unread — ${why}`;
  }
  const each = placed
    .map((reading) =>
      reading.direction === "same"
        ? `${reading.package}@${reading.named} is what is installed`
        : `${reading.package}@${reading.named} is behind ${String(reading.installed)}`,
    )
    .join(", ");
  return `no candidate npm names is ahead of the lockfile — ${each} — so this waits on upstream rather than on a migration here`;
}

/**
 * A group's label: the candidates, capped so one line stays one line.
 *
 * Two names and a count, rather than all of them. The full list is on the
 * detail line for a group that has one, and `@sentry/react-native / expo /
 * expo-auth-session / expo-linking / expo-router (1, up to moderate)` inside a
 * comma-separated list of four such labels is how the first version read.
 */
export function groupLabel(candidates: readonly string[]): string {
  if (candidates.length <= 2) return candidates.join(" / ");
  return `${candidates.slice(0, 2).join(" / ")} +${String(candidates.length - 2)}`;
}
