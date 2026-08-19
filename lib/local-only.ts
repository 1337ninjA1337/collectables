/**
 * The `*.local.*` naming convention, said once for the whole repository.
 *
 * A local-only file is one this repository ASKS a reader to create and fill
 * with a real credential — `docs/powerbi/queries.local.m` holds a Supabase
 * session pooler host and a `service_role` database password, because the
 * committed `queries.m` tells its reader to put them there rather than in
 * itself. `.gitignore` carries `*.local.*`, so git will never take one, and
 * that is the whole point: the mistake is made impossible rather than merely
 * detected after the fact.
 *
 * It arrived inside `lib/secret-scan.ts`, which is where it was needed first
 * and not what it is about. The scan honours the convention; it does not own
 * it. Anything else that reads the working tree and reports on the COMMITTED
 * set — the bundle scan, a future census, the next guard somebody writes —
 * wants the same answer, and the alternative to a shared home is the shape
 * `NEVER_WALKED` had before `lib/source-dirs.ts`: one rule written out twice,
 * drifting at the point where nobody looks.
 *
 * Pure: no filesystem, no `node:` imports, so a suite can take it and so can a
 * guard wrapper. Whether git really ignores the pattern is not something this
 * module can know — that is asserted in `__tests__/local-only.test.ts`, which
 * asks git both directions: that `.gitignore` still covers the pattern, and
 * that nothing tracked matches it anyway (a `git add -f` beats `.gitignore`,
 * and a force-added `.local.` file is the one way this convention could hide a
 * committed credential).
 */

/** The segment that marks a file git will never take. */
export const LOCAL_ONLY_MARKER = ".local.";

/**
 * True for a path covered by the `.local.` convention.
 *
 * Tested on the BASENAME, because the marker is about what a file is CALLED.
 * A substring test over the whole path would take `docs/local/queries.m` out
 * of every scan that honours this, and a directory nobody scans is worse than
 * a file nobody scans. `local.ts`, `docs/local/x.ts` and `my.localization.ts`
 * are ordinary tracked files and none of them carries a `.local.` segment.
 */
export function isLocalOnlyPath(relative: string): boolean {
  const name = relative.split(/[\\/]/).pop() ?? relative;
  return name.includes(LOCAL_ONLY_MARKER);
}

/**
 * Split a walk's output into what a scan reads and what the convention took.
 *
 * A `filter` answers half the question and throws the other half away, and the
 * half it throws away is the one a reader in front of a failure needs. Both
 * halves come back here so the caller does not accumulate into module-level
 * state from inside a predicate — which works exactly once per process and is
 * the shape that silently double-counts the first time anything calls the
 * walker twice.
 */
export function partitionLocalOnly(paths: readonly string[]): {
  scanned: string[];
  localOnly: string[];
} {
  const scanned: string[] = [];
  const localOnly: string[] = [];
  for (const rel of paths) (isLocalOnlyPath(rel) ? localOnly : scanned).push(rel);
  return { scanned, localOnly };
}

/**
 * What git said about the skipped names, or why it was not asked.
 *
 * The convention rests on a claim about git — that these files cannot be
 * committed — and `git add -f` beats `.gitignore`, so a force-added `.local.`
 * file is a COMMITTED credential sitting outside the scan. That claim was
 * checked in `__tests__/local-only.test.ts`, which means `npm run lint:secrets`
 * on its own would happily skip such a file in any checkout where the suite was
 * not run. The guard asks it itself now.
 *
 * `asked: false` is a real answer rather than an error: the guard is spawned
 * against scratch roots that are not work trees at all, and a scan that refused
 * to run outside git would be a scan its own fixtures could not exercise. What
 * it may not do is stay quiet about it, which is why the reason is carried.
 */
export type LocalOnlyTrackedProbe =
  | { readonly asked: true; readonly tracked: readonly string[] }
  | { readonly asked: false; readonly reason: string };

/**
 * The refusal text for skipped files git is tracking, empty when there are
 * none or when git could not be asked.
 *
 * A tracked `.local.` file is the one way this convention can hide a real leak,
 * so it fails the run rather than being reported as a curiosity — and it names
 * the files, because "something is wrong with your ignore rules" is not a thing
 * anybody can act on.
 */
export function formatTrackedLocalOnly(probe: LocalOnlyTrackedProbe): string {
  if (!probe.asked || probe.tracked.length === 0) return "";
  const sorted = [...probe.tracked].sort();
  return [
    `${sorted.length} file(s) are tracked by git AND skipped by the \`${LOCAL_ONLY_MARKER}\` ` +
      `rule, so a committed credential in one of them would never be scanned:`,
    ...sorted.map((rel) => `  ${rel}`),
    `\`git rm --cached\` them, or rename them so they are scanned. \`.gitignore\` covers ` +
      `\`*${LOCAL_ONLY_MARKER}*\`, so these were force-added.`,
  ].join("\n");
}

/**
 * How many names a pass line spells out before it starts counting.
 *
 * A clean run's report is one line and stays one line; a checkout with a dozen
 * local-only copies in it should not turn that into a paragraph. The remainder
 * is COUNTED rather than dropped, because a scan that quietly stops naming
 * what it skipped is the silence this whole convention is meant to end.
 */
export const LOCAL_ONLY_NAMES_SHOWN = 5;

/**
 * The clause a passing guard appends: what it did not read, and why not.
 *
 * Empty string when nothing was skipped, so the caller can append it without
 * a branch and a normal run's line is unchanged. Names are sorted, because a
 * report that reads differently on two machines is a report nobody diffs.
 */
export function formatLocalOnlySkips(
  skipped: readonly string[],
  probe?: LocalOnlyTrackedProbe,
): string {
  if (skipped.length === 0) return "";
  const sorted = [...skipped].sort();
  const shown = sorted.slice(0, LOCAL_ONLY_NAMES_SHOWN);
  const rest = sorted.length - shown.length;
  const names = rest > 0 ? `${shown.join(", ")}, +${rest} more` : shown.join(", ");
  // What the skip RESTS on, said in the same line as the skip. A pass line
  // that reports "skipped 3" without saying whether git was asked leaves the
  // reader unable to tell a verified exemption from an assumed one.
  const verified =
    probe === undefined ? "" : probe.asked ? " (none tracked by git)" : ` (${probe.reason})`;
  return `skipped ${sorted.length} local-only file(s): ${names}${verified}`;
}

/**
 * The note a FAILING guard appends, which is the case this exists for.
 *
 * The confusing failure is not the one where the convention works. It is the
 * one where a reader followed the instruction, misspelled the name
 * (`queries-local.m`, `queries.local`), and got a red run naming their own
 * pasted password with no hint that the NAME is what put the file in the scan.
 * Nothing printed the rule, so the rule was invisible at the only moment it
 * mattered.
 *
 * So the note states the convention, and then says what was skipped — `none`
 * included, because "your file is not in this list" is the sentence that
 * closes the loop for the reader who thought it would be.
 */
export function formatLocalOnlyNote(skipped: readonly string[]): string {
  const sorted = [...skipped].sort();
  const listed = sorted.length === 0 ? "none this run" : `this run: ${sorted.join(", ")}`;
  return [
    `Files whose NAME carries \`${LOCAL_ONLY_MARKER}\` are not read: \`.gitignore\` covers ` +
      `\`*${LOCAL_ONLY_MARKER}*\`, so git never takes them and this scan is about the ` +
      `committed set. Skipped ${listed}.`,
    `If a finding above is in a copy you meant to keep out of git, the name is the problem — ` +
      `\`queries-local.m\` and \`queries.local\` carry no \`${LOCAL_ONLY_MARKER}\` segment. ` +
      `Rename it to \`queries${LOCAL_ONLY_MARKER}m\`.`,
  ].join("\n");
}
