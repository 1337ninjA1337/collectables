/**
 * What `package-lock.json` says is installed, read once.
 *
 * ## Why this is a module rather than a function somewhere
 *
 * The walk below lived in `lib/named-fix-direction.ts`, whose subject is which
 * WAY a named fix points. By the time it had three callers, only one of them
 * was asking that question: `scripts/check-audit-baseline.ts` calls it to
 * build a gate input, `scripts/check-sentry-version.ts` to ask what major is
 * installed, and `readNamedFix` to place a version. Fourteen lines of
 * lockfile-v3 knowledge — the `node_modules/` prefix, the nested-path filter,
 * the four type guards — sat in a file that is not about lockfiles, and two of
 * its three importers had to reach through a module whose name told them
 * nothing about what they were importing.
 *
 * ## The one shape, and the `unknown` it comes from
 *
 * npm's lockfile is `JSON.parse` output, so it is `unknown` and every reader
 * of it is four type guards deep. Carrying that `unknown` to the leaves is
 * what this tree did until 2026-10-09, and it cost a guard per candidate per
 * group across four readers. The `unknown` stops at
 * {@link lockedVersions}: callers hand it the parse and take an
 * {@link InstalledVersions}, which is the only shape any of them wanted.
 *
 * A caller that could not read the file at all is a different state from one
 * that read it and found nothing, and this module deliberately does not model
 * it: an unreadable lockfile never reaches here, because the process that
 * failed to read it is the one that has to say so. See
 * `scripts/check-audit-baseline.ts`, where that distinction is a union.
 */

/**
 * Every root install the lockfile resolved, as `name -> version`.
 *
 * A plain record rather than a `Map` because it rides `AuditVerdict`, which is
 * a data shape fixtures write by hand. An absent key is a package with no root
 * entry, which the readers treat as "no answer" rather than as a zero.
 */
export type InstalledVersions = Readonly<Record<string, string>>;

/** The lockfile key prefix a root install lives under. */
const LOCK_ROOT_PREFIX = "node_modules/";

/** What marks a key as a NESTED install rather than a root one. */
const NESTED_SEGMENT = "/node_modules/";

/**
 * Every root install `package-lock.json` resolved, as `name -> version`.
 *
 * npm's lockfile v3 keys every install path, and the root install of a package
 * is `node_modules/<name>`. A nested copy (`node_modules/a/node_modules/b`) is
 * deliberately NOT kept: the question is what a contributor's tree is on, and
 * a nested duplicate is a second answer to a question with one answer — this
 * tree has `react-native` at both 0.81.5 and a nested 0.86.0, which is the
 * dependency-tree finding `npm run bundle:native` fails on and exactly the
 * case where picking one silently would mislead. A scoped name keeps its own
 * slash (`node_modules/@sentry/react-native`), so the test is "no FURTHER
 * `/node_modules/` segment" rather than "no slash".
 *
 * ## One walk, where the file was read
 *
 * This used to be `lockedVersion(lock, name)`: four type guards against an
 * `unknown`, re-run per candidate, per group, per call site — and the
 * `unknown` was carried all the way to the leaves because the thing that
 * produced it may return anything. That argues for parsing where the file is
 * READ and handing the shape the readers actually want onward, which is this
 * record. Everything downstream takes it, so the lockfile's shape is a fact
 * established once rather than re-asked at every lookup.
 *
 * An unreadable lockfile is an EMPTY record, not an error: the callers that
 * need to tell "no lockfile" from "a lockfile that answered nothing" do it by
 * whether they were handed one at all, which is the distinction
 * `AuditVerdict.tree` and `FixCommandTarget.placed` are built on.
 */
export function lockedVersions(lock: unknown): InstalledVersions {
  if (typeof lock !== "object" || lock === null) return {};
  const packages = (lock as { packages?: unknown }).packages;
  if (typeof packages !== "object" || packages === null) return {};
  const installed: Record<string, string> = {};
  for (const [key, entry] of Object.entries(packages as Record<string, unknown>)) {
    if (!key.startsWith(LOCK_ROOT_PREFIX)) continue;
    const name = key.slice(LOCK_ROOT_PREFIX.length);
    if (name === "" || name.includes(NESTED_SEGMENT)) continue;
    if (typeof entry !== "object" || entry === null) continue;
    const version = (entry as { version?: unknown }).version;
    if (typeof version === "string" && version !== "") installed[name] = version;
  }
  return installed;
}
