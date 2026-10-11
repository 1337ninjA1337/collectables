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
 * ## The state the walk cannot have, and where it is now modelled
 *
 * A caller that could not read the file at all is a different state from one
 * that read it and found nothing, and {@link lockedVersions} still does not
 * model it — an empty record is both. That distinction used to live in
 * `scripts/check-audit-baseline.ts` as a pair of optional fields,
 * `{ installed?, note? }`, on the grounds that the process that failed to read
 * the file is the one that has to say so. Two of that shape's four states mean
 * nothing: `{ installed, note }` together and `{}` alone are both
 * constructible and neither says anything, which is the shape `AuditTree` was
 * criticised for on 2026-10-07 and fixed by making both fields required.
 *
 * {@link InstalledRead} is the two states that exist, and
 * {@link readInstalledVersions} is the only thing that produces them. The
 * process keeps the one part only a process can do — the `readFileSync` — and
 * hands it in as a thunk, which is the split `auditReader` and `runAuditGate`
 * already use for the registry call: the decision and the sentence explaining
 * it come out of one place a test can run, and the file read stays at the
 * boundary.
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

/**
 * What the lockfile said, or the reason nothing was read from it.
 *
 * The two-sided union {@link InstalledAnswer} and {@link InstalledUnreadable}
 * make up, modelled for the same reason `AuditAnswer | AuditSkip` is one type
 * up: the alternative is a record of optional fields whose unwanted
 * combinations are spellable, and a reader that has to work out from
 * `note !== undefined` which half it is holding.
 *
 * No `installedRead`/`installedUnreadable` constructors, against the nine and
 * one that argued for `skipRead` and `answerRead` — both halves are
 * constructed exactly once, on adjacent branches of
 * {@link readInstalledVersions}, so the mistake those constructors exist to
 * stop (a `kind` written by hand in a branch that is not that half) has one
 * function's worth of surface and the two literals sit six lines apart. A
 * second producer is when to add them.
 */
export type InstalledRead = InstalledAnswer | InstalledUnreadable;

/**
 * The half where the lockfile parsed: what it resolved, however little.
 *
 * An EMPTY record is this half, not the other one. A lockfile that parsed and
 * named no root install has answered — with nothing — and the gate's own floor
 * is what catches that ("the lockfile answered for none of the claimed
 * packages"). Collapsing it into {@link InstalledUnreadable} would name the
 * wrong cause for a tree that is simply not installed.
 */
export interface InstalledAnswer {
  readonly kind: "read";
  readonly installed: InstalledVersions;
  readonly note?: undefined;
}

/**
 * The half where it did not: nothing was read, and the sentence saying so.
 *
 * The `installed?: undefined` mirror is what lets the one caller pass
 * `read.installed` to {@link InstalledVersions}-taking options without
 * narrowing first — the same reason {@link InstalledAnswer} carries
 * `note?: undefined`, and the same reason `AuditAnswer` carries
 * `report?: undefined`. The gate's two optional-`installed` options are
 * exactly this absence, so a caller holding an un-narrowed read already has
 * the argument it needs.
 */
export interface InstalledUnreadable {
  readonly kind: "unreadable";
  readonly installed?: undefined;
  readonly note: string;
}

/**
 * Read the lockfile through `read`, and say which of the two states happened.
 *
 * `read` is a thunk returning the file's text rather than a path, for the
 * reason `runAuditGate` takes `read` rather than spawning: the one part only a
 * process can do stays at the process boundary, and everything decided about
 * the result — including the sentence — is runnable by a test. A caller that
 * cannot reach `node:fs` has no business in this module, and a test that has
 * to plant a broken file on disk to exercise the unreadable half is a test
 * nobody writes.
 *
 * ## Why an unreadable lockfile is not an error
 *
 * Named, not swallowed, and not thrown either. Two of the audit gate's failing
 * lists need a fix DIRECTION and a direction needs an installed version, so an
 * unread lockfile makes them empty for the same reason a healthy tree does —
 * and a check that could not ask must not read as a pass. A gate that died on
 * a missing lockfile would be a gate failing for a reason it is not about.
 * The note is the half only the reader can see; the floor inside the gate is
 * the half it can.
 *
 * Both failures are one `catch` on purpose: `read` throwing (no file, no
 * permission) and `JSON.parse` refusing its output are the same answer to the
 * same question, and the caller prints the same sentence for either. What
 * distinguishes them is already in the message npm or the OS produced, which
 * is why it is quoted rather than summarised.
 *
 * @param checkName The gate's own name, so the note reads as that check's line.
 */
export function readInstalledVersions(read: () => string, checkName: string): InstalledRead {
  try {
    const lock: unknown = JSON.parse(read());
    return { kind: "read", installed: lockedVersions(lock) };
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    return {
      kind: "unreadable",
      note: `${checkName}: package-lock.json could not be read (${cause}), so no fix direction and no namedFix claim was checked on this run.`,
    };
  }
}
