import { stripComments } from "@/lib/strip-comments";

/**
 * Scanner behind `scripts/check-console-swap.ts` (`npm run lint:console-swap`):
 * shipped code may not assign to a method of the global `console`.
 *
 * The suites already had this rule — `__tests__/default-console-seams.test.ts`
 * bans the hand-rolled swap there, because a swap saves and restores ONE stream
 * and a case that starts writing to a second loses it into the runner's output.
 * That sweep can only see `__tests__/`, and nothing said the rule applied
 * anywhere else. Nothing outside the suites does it today, which is the moment
 * to write it down: `app/`, `components/`, `lib/` and `scripts/` are swept here,
 * so the rule a contributor meets is the one `lint:all` prints rather than one
 * they find after a test run.
 *
 * WHY it is a rule and not a preference, in the two places it could land.
 * In the app, `console` is process-global and lives as long as the session: a
 * component that replaces `console.warn` to quieten one noisy dependency
 * silences every other warning in the app, including the ones a crash report
 * would have carried, and there is no `finally` on a React tree. In a guard
 * script, the swap outlives the function that made it and the next guard's
 * report goes into somebody's array — `scripts/lint-all.ts` runs the guards in
 * child processes today, and that is an implementation detail rather than a
 * promise. The seam a caller actually wants is an injected writer, which is
 * what every module in `lib/` that logs already takes.
 *
 * Reading a console method is untouched: `const write = console.log` is how the
 * default-seam pattern is written throughout this tree, and banning it would
 * ban the thing the rule exists to push people towards.
 *
 * Pure module: no filesystem access — the CLI walks the directories and hands
 * sources over, so the matcher is unit-testable under node --test. Comments are
 * stripped (via the shared `stripComments`) so this doc block can spell the
 * banned form out without tripping the scan.
 */

/**
 * `console.warn = …` and `console["warn"] = …`, however either is spaced.
 *
 * Both spellings, for the reason the suite sweep learned: a ban that knew only
 * the dotted form is dodged by a bracket that means exactly the same thing, and
 * the computed form is the one a loop over method names writes. `[^=]` after
 * the `=` is what keeps `console.warn === undefined` out; `!==` and the
 * relational forms never reach it, because the character after the method name
 * is not an `=` at all.
 *
 * ANY PROPERTY, NOT AN ENUMERATED SIX. The dotted half used to spell out
 * `log|error|warn|info|debug|trace` while the bracket half beside it matched
 * whatever was between the brackets — one pattern whose two halves disagreed
 * about what the rule was, and the narrower half was the one a `console.dir =`
 * or a `console.table =` walked straight through. The rule is not "these six
 * streams"; it is "assigning to the global console at all", which is what the
 * bracket half already said and what `\w+` now says on both sides. It also ends
 * the list's second home: `__tests__/helpers/capture-console.ts` derives the
 * streams it swaps from one array, and this pattern is imported by the suite
 * ban rather than restated, so a stream added there is banned by the same edit
 * that captures it.
 *
 * NO `g` FLAG, deliberately. `.test` on a global pattern advances `lastIndex`
 * between calls, so a pattern reused across a file walk skips every other file
 * and the sweep goes green having read half the tree. The scanner below calls
 * `.test` once per line, which is exactly that hazard. The sibling rule in
 * `__tests__/helpers/offence-sweep.ts` refuses a `g` rule outright; this module
 * exports one pattern and pins the property with a case instead.
 */
export const CONSOLE_SWAP = /console\s*(?:\.\w+|\[[^\]]+\])\s*=[^=]/;

export type ConsoleSwap = {
  readonly file: string;
  readonly line: number;
  /** The offending source line, trimmed, for the report. */
  readonly snippet: string;
};

/**
 * A source that DOES swap a console method, for the guard's own positive
 * control.
 *
 * A ban is satisfied by a pattern that has stopped matching anything at all —
 * a renamed method, a regex edited during a debugging session — and a clean
 * tree looks identical either way. The suite sweep controls for that against a
 * real file that legitimately does the banned thing; there is no such file
 * outside `__tests__/`, so the guard carries its own and refuses to report a
 * clean tree until the scanner has flagged it.
 *
 * SPLIT so that this module's own source does not contain the banned form. The
 * alternative was exempting `lib/check-console-swap.ts` from a sweep that walks
 * `lib/`, which is a hole in the shape of a whole file: a genuine swap written
 * here would then be the one place the rule cannot see. A join is cheaper than
 * an exemption nobody re-reads.
 */
export const CONSOLE_SWAP_PROBE = `${"console"}.warn = () => {};\n`;

/** Scan one source string for assignments to a console method. */
export function findConsoleSwaps(
  file: string,
  source: string,
): readonly ConsoleSwap[] {
  const swaps: ConsoleSwap[] = [];
  const lines = stripComments(source).split("\n");
  lines.forEach((line, index) => {
    if (!CONSOLE_SWAP.test(line)) return;
    swaps.push({ file, line: index + 1, snippet: line.trim() });
  });
  return swaps;
}

/**
 * The refusal, naming every offender and the seam that replaces it.
 *
 * Empty string when there is nothing to report, so the caller decides what a
 * clean tree prints.
 */
export function formatConsoleSwapReport(
  checkName: string,
  swaps: readonly ConsoleSwap[],
): string {
  if (swaps.length === 0) return "";
  const lines = swaps.map(
    (swap) => `  ${swap.file}:${swap.line}  ${swap.snippet}`,
  );
  return [
    `${checkName}: ${swaps.length} assignment(s) to a global console method:`,
    ...lines,
    "",
    "The global console outlives whatever swapped it: in the app it stays swapped for the session, silencing every other caller's warnings including the ones a crash report would have carried; in a guard script the next guard's report goes into somebody's array. Take an injected writer instead — every module in lib/ that logs already has one, defaulting to console at the call site. Suites have their own answer for the same problem: captureConsole/beginCapture in __tests__/helpers/capture-console.ts, which is the ONE place in this repository allowed to do this.",
  ].join("\n");
}
