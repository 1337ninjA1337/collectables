import { stripComments } from "@/lib/strip-comments";

/**
 * Scanner behind `scripts/check-console-swap.ts` (`npm run lint:console-swap`):
 * shipped code may not assign to any property of the global `console`.
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
 * `\bconsole` RATHER THAN `console`, because the widened dotted half made an
 * old looseness reachable: without the boundary, any identifier ENDING in the
 * word matched, so `myconsole.log = noop` — a local wrapper being configured,
 * not the global being replaced — was an offender the report could only
 * describe as one. Nothing in this tree is named that way, which is exactly
 * why it would have been found by whoever wrote the first one.
 *
 * NO `g` FLAG, deliberately. `.test` on a global pattern advances `lastIndex`
 * between calls, so a pattern reused across a file walk skips every other file
 * and the sweep goes green having read half the tree. The scanner below calls
 * `.test` once per line, which is exactly that hazard. The sibling rule in
 * `__tests__/helpers/offence-sweep.ts` refuses a `g` rule outright; this module
 * exports one pattern and pins the property with a case instead.
 */
export const CONSOLE_SWAP = /\bconsole\s*(?:\.\w+|\[[^\]]+\])\s*=[^=]/;

/**
 * The rule's subject, in the one wording every reader of it prints.
 *
 * Four strings said what this rule is and they lived in four files — the
 * scanner's heading below, the wrapper's clean-tree line, the wrapper's probe
 * refusal and the `LINT_GUARDS` blurb. Keeping one sentence true across them
 * was four hand edits, and a fifth reader would have made it five. The check
 * name was already shared; this is the other half of what those strings say.
 *
 * `LINT_GUARDS` does NOT import it — the registry is a pure data module that
 * depends on no guard, and inverting that for one phrase would make the
 * registry's imports grow with the guard count. `__tests__/check-console-swap
 * .test.ts` asserts the blurb still contains this phrase instead, so the
 * fourth reader is policed rather than merely remembered.
 */
export const CONSOLE_SWAP_SUBJECT = "a property of the global console";

/**
 * The word `console`, never written here as one literal.
 *
 * This module is swept by the guard it implements (the walk covers `lib/`), so
 * every fixture below has to spell the banned form without BEING the banned
 * form. Four files had independently invented this trick and each explained it
 * in its own comment; it is stated once here and the fixtures are exported, so
 * a fifth caller borrows the explanation with the data.
 */
const CONSOLE = ["con", "sole"].join("");

/** One `console.<property> = …` line, built without the literal. */
export function consoleSwapFixture(property: string): string {
  return `${CONSOLE}.${property} = () => {};`;
}

/** A line the rule must reach a stated verdict on, and why that verdict. */
export type ConsoleSwapFixture = {
  /** The source line, as a scanner would meet it. */
  readonly line: string;
  /** True when the line assigns to the global console. */
  readonly offends: boolean;
  /** What the line is, for the failure message of whichever suite walks it. */
  readonly why: string;
};

/**
 * Both sides of the rule, in one table two suites walk.
 *
 * The negative side used to be asserted in two places that did not agree about
 * what it covered: `__tests__/check-console-swap.test.ts` pinned the read form,
 * the comparison form and the wrapper form, while
 * `__tests__/default-console-seams.test.ts` pinned three lines chosen to be the
 * ones a widening would break. Two hand-written lists of the same rule is the
 * two-copies problem the shared `CONSOLE_SWAP` had just solved one level up,
 * and the sides would have drifted the same way the patterns did — silently,
 * with both suites still green.
 *
 * The `window.` / `globalThis.` rows are the boundary's other half, and they
 * are must-MATCH on purpose. `\bconsole` reads as "the identifier must be
 * exactly console"; what it actually says is "the identifier must END at
 * console", so a qualified spelling of the same global is caught and a local
 * called `myconsole` is not. Both are right — `window.console` IS the thing the
 * rule is about — and the difference is invisible from the pattern alone.
 */
export const CONSOLE_SWAP_FIXTURES: readonly ConsoleSwapFixture[] = [
  {
    line: consoleSwapFixture("warn"),
    offends: true,
    why: "the dotted form, which is what a swap is usually written as",
  },
  {
    line: `${CONSOLE}["warn"] = noop;`,
    offends: true,
    why: "the bracket form, which means exactly the same thing",
  },
  {
    line: `${CONSOLE}[method] = collect;`,
    offends: true,
    why: "the computed form, which is what a loop over method names writes",
  },
  {
    line: `${CONSOLE} [ method ] = collect;`,
    offends: true,
    why: "the computed form, spaced the way a formatter might leave it",
  },
  {
    line: consoleSwapFixture("somethingNodeAddsNextYear"),
    offends: true,
    why: "a property no version of node has yet — the rule is the global, not an enumerated six",
  },
  {
    line: `window.${consoleSwapFixture("log")}`,
    offends: true,
    why: "the window-qualified spelling of the same global, which the boundary admits because the identifier ENDS at console",
  },
  {
    line: `globalThis.${CONSOLE}["warn"] = collect;`,
    offends: true,
    why: "the globalThis-qualified spelling, which is the same global under the portable name",
  },
  {
    line: `const write = ${CONSOLE}.log;`,
    offends: false,
    why: "reading a method, which is how every default seam in this tree is written — banning it would ban the fix",
  },
  {
    line: `export function log(write: Writer = ${CONSOLE}.error) {}`,
    offends: false,
    why: "the default-seam parameter, the shape the rule argues for",
  },
  {
    line: `if (${CONSOLE}.warn === undefined) return;`,
    offends: false,
    why: "a comparison — `[^=]` after the `=` is what keeps it out",
  },
  {
    line: `if (${CONSOLE}.warn !== original) throw new Error("swapped");`,
    offends: false,
    why: "a negated comparison, which never reaches the `=` at all",
  },
  {
    line: `const swapped = ${CONSOLE}[method] === undefined;`,
    offends: false,
    why: "a comparison through the bracket form",
  },
  {
    line: `my${CONSOLE}.log = () => {};`,
    offends: false,
    why: "a local wrapper being configured, not the global being replaced — what `\\bconsole` was added for",
  },
  {
    line: `fake${CONSOLE}["warn"] = collect;`,
    offends: false,
    why: "the same local-wrapper case through the bracket form",
  },
];

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
 * BUILT rather than written, so that this module's own source does not contain
 * the banned form. The alternative was exempting `lib/check-console-swap.ts`
 * from a sweep that walks `lib/`, which is a hole in the shape of a whole file:
 * a genuine swap written here would then be the one place the rule cannot see.
 * A join is cheaper than an exemption nobody re-reads — and it is now the same
 * join `CONSOLE_SWAP_FIXTURES` uses, rather than a second copy of the trick.
 */
export const CONSOLE_SWAP_PROBE = `${consoleSwapFixture("warn")}\n`;

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
    `${checkName}: ${swaps.length} assignment(s) to ${CONSOLE_SWAP_SUBJECT}:`,
    ...lines,
    "",
    "The global console outlives whatever swapped it: in the app it stays swapped for the session, silencing every other caller's warnings including the ones a crash report would have carried; in a guard script the next guard's report goes into somebody's array. Take an injected writer instead — every module in lib/ that logs already has one, defaulting to console at the call site. Suites have their own answer for the same problem: captureConsole/beginCapture in __tests__/helpers/capture-console.ts, which is the ONE place in this repository allowed to do this.",
  ].join("\n");
}
