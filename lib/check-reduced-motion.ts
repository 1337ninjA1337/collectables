import { annotation } from "./github-annotations";
import { importedModules, specifierEndsWithModule } from "./import-specifiers";
import { stripComments } from "./strip-comments";

/**
 * A fifth animated surface that never asks, refused.
 *
 * WHAT THIS IS THE FLOOR UNDER. On 2026-09-17 four surfaces — the toast
 * entrance, the skeleton shimmer, the swipe pager and the wishlist sheet —
 * were taught to read `AccessibilityInfo.isReduceMotionEnabled` through
 * `lib/reduced-motion.ts`. The sweep that proved it names those four files BY
 * HAND: a list in a test, which is green on the day it is written and says
 * nothing at all about the fifth surface somebody adds next month. The
 * setting is not a preference about taste — vestibular disorders are why it
 * exists — so "nobody remembered" is the failure mode worth spending a guard
 * on.
 *
 * THE RULE IS THE IMPORT, deliberately. A file that drives an animation must
 * have `@/lib/reduced-motion` in scope; what it then DOES with the signal is
 * the thing the module's header is about, and there are three right answers
 * (a `motionDuration` of zero for a transition whose callback commits state, a
 * `setValue` for a spring with nothing waiting on it, an early return for a
 * loop). A text scan cannot tell which of the three a surface needed, and a
 * guard that guessed would be wrong on two thirds of this tree. What it CAN
 * say is that the author was handed the question. That is the whole claim,
 * and it is the one that catches the surface written by someone who has never
 * read the header.
 *
 * THE DRIVERS, not the combinators. `Animated.timing`, `spring`, `decay` and
 * `loop` are the calls that put a value in motion. `sequence`, `parallel` and
 * `stagger` only arrange drivers, so a file holding one holds a driver too and
 * naming them would add no coverage and one more thing to keep in step. `loop`
 * is in the list despite being a combinator because it is the shape with its
 * own answer: `Animated.loop` of a zero-duration timing is not a still image,
 * it is a frame callback that never stops.
 *
 * COMMENTS ARE BLANKED FIRST, and this module is the reason to check that it
 * works: the paragraph above names three of the four calls, `lib/reduced-
 * motion.ts`'s header names two, and `components/skeleton.tsx` explains its
 * early return by quoting `Animated.loop`. A rule that read prose would report
 * every file that documents itself. `stripComments` preserves offsets, so the
 * reported line is still the real one. String literals stay: an animation
 * driver inside one is not a thing this repository has, and blanking them
 * would be a hole with no case behind it.
 *
 * SCANNED OVER app/ + components/ + lib/ rather than over `MARKUP_DIRS`.
 * Twelve context providers live in `lib/` and render JSX, so "animation lives
 * where the markup does" is a sentence this tree has already falsified once.
 * The subject is code that runs on a device, which is the same walk
 * `check-inline-hex` takes for the same reason.
 */

/** The module a surface has to have in scope to have asked the question. */
export const REDUCED_MOTION_MODULE = "reduced-motion";

/** Where that module lives, for the report's second line. */
export const REDUCED_MOTION_OWNER = "@/lib/reduced-motion";

/**
 * The `Animated.*` calls that start motion.
 *
 * Exported so a suite can state the list rather than re-type it: the case that
 * matters most here is "every driver in this set is actually matched", and a
 * second copy of the names in the test would make it a case about itself.
 */
export const MOTION_DRIVERS: readonly string[] = ["timing", "spring", "decay", "loop"];

const MOTION_DRIVER_CALL = new RegExp(
  `\\bAnimated\\s*\\.\\s*(${MOTION_DRIVERS.join("|")})\\s*\\(`,
  "g",
);

/** One animation driven by a file that never imports the setting. */
export interface ReducedMotionFinding {
  /** Repo-relative path of the file. */
  readonly file: string;
  /** 1-indexed line number of the driver call. */
  readonly line: number;
  /** 1-indexed column of the driver call. */
  readonly column: number;
  /** Which driver — `timing`, `spring`, `decay` or `loop`. */
  readonly driver: string;
}

/** 1-indexed line and column of an offset, by counting the breaks before it. */
function lineColumn(source: string, at: number): { line: number; column: number } {
  const before = source.slice(0, at);
  const lastBreak = before.lastIndexOf("\n");
  return { line: before.split("\n").length, column: at - lastBreak };
}

/**
 * Every animation driver in one file, ignoring prose.
 *
 * Separate from the import question so the wrapper can count the surfaces it
 * found: a run that reports "no findings" having matched no driver at all has
 * not proved this rule, it has lost its subject — the day somebody moves this
 * app to Reanimated's `withTiming`, every one of these patterns stops matching
 * and the guard goes quietly, permanently green.
 */
export function findMotionDrivers(file: string, source: string): ReducedMotionFinding[] {
  const code = stripComments(source);
  const found: ReducedMotionFinding[] = [];
  for (const match of code.matchAll(MOTION_DRIVER_CALL)) {
    const { line, column } = lineColumn(code, match.index);
    found.push({ file, line, column, driver: match[1] });
  }
  return found;
}

/** Whether a file has the setting in scope, by any spelling of the specifier. */
export function consultsReducedMotion(source: string): boolean {
  return importedModules(source).some((specifier) =>
    specifierEndsWithModule(specifier, REDUCED_MOTION_MODULE),
  );
}

/**
 * The rule over one file: its drivers, or none if it already asked.
 *
 * A file that imports the module is not scanned for drivers at all, which is
 * why the owner module itself needs no exemption — `lib/reduced-motion.ts`
 * drives nothing, and a surface that consults it is by definition compliant.
 */
export function findUnaskedAnimations(file: string, source: string): ReducedMotionFinding[] {
  if (consultsReducedMotion(source)) return [];
  return findMotionDrivers(file, source);
}

/** Human-readable failure report; empty string when there is nothing to say. */
export function formatReducedMotionReport(findings: readonly ReducedMotionFinding[]): string {
  if (findings.length === 0) return "";
  const files = new Set(findings.map((f) => f.file));
  const lines = [
    `Found ${findings.length} animation(s) in ${files.size} file(s) that never ask about reduce-motion.`,
    `Import ${REDUCED_MOTION_OWNER} and pick the shape that fits: motionDuration(ms, reduced) for a transition whose completion callback commits state, value.setValue(rest) for a spring with nothing waiting on it, and an early return for a loop — Animated.loop of a 0ms timing is a frame callback that never stops.`,
  ];
  for (const f of findings) {
    lines.push(`  ${f.file}:${f.line}:${f.column}  Animated.${f.driver}(`);
  }
  return lines.join("\n");
}

/** The same findings as GitHub Actions annotations, one per animation. */
export function reducedMotionAnnotations(
  findings: readonly ReducedMotionFinding[],
): string[] {
  return findings.map((f) =>
    annotation(
      "error",
      `Animated.${f.driver}() runs unconditionally — import ${REDUCED_MOTION_OWNER} and consult the setting.`,
      { file: f.file, line: f.line, col: f.column, title: "Animation ignores reduce-motion" },
    ),
  );
}
