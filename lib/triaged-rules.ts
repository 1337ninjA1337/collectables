/**
 * The ungated rules whose every finding has been read, in one list.
 *
 * ## Why this is a module rather than a literal in the gate script
 *
 * It was a literal in `scripts/check-eslint-gate.ts`, which meant two things
 * no list of registries should mean. A third reading was two edits — write
 * the registry, then wire it up in a script — which is the shape
 * `LINT_GUARDS` exists to avoid one directory over. And the wiring itself was
 * unchecked: the rule id sat beside the `findingsByFile()` call as a string
 * somebody typed, so a registry attached to the wrong rule read as a complete
 * reading of a rule it had never looked at, and the gate would have agreed.
 *
 * Each registry now declares its own `RULE`, and the entries below are built
 * from it. The pairing is no longer something to get right.
 *
 * ## What it is for
 *
 * Two readers, which is the reason it is here and not in either of them:
 *
 * - `check-eslint-gate` holds the live run against each registry per file, so
 *   a NEW finding of a read rule fails until somebody writes a verdict.
 * - `lib/eslint-report-snapshot.ts` takes the per-rule TOTALS from here
 *   instead of holding its own copy of them. A verdict added to a registry
 *   used to move a number the snapshot also stated, so one edit produced two
 *   red checks with two different instructions.
 */

import { type TriagedRule } from "./eslint-gate";
import * as exhaustiveDeps from "./exhaustive-deps-triage";
import * as setStateInEffect from "./set-state-in-effect-triage";

/**
 * Neither rule is gated and neither should be: 26 of the 30
 * `set-state-in-effect` findings are correct as written, and gating would
 * mean 26 eslint-disable comments written to make a gate green. What IS gated
 * is that the readings stay COMPLETE — a new finding of either rule fails the
 * leg until somebody writes a verdict for it, which is a much smaller ask
 * than a fix and is the one that keeps a registry from describing the day it
 * was written.
 */
export const TRIAGED_RULES: readonly TriagedRule[] = [
  {
    rule: setStateInEffect.RULE,
    registry: "lib/set-state-in-effect-triage.ts",
    expected: setStateInEffect.findingsByFile(),
  },
  {
    rule: exhaustiveDeps.RULE,
    registry: "lib/exhaustive-deps-triage.ts",
    expected: exhaustiveDeps.findingsByFile(),
  },
];

/**
 * Each read rule's live finding count, summed out of its registry.
 *
 * This is the number `lib/eslint-report-snapshot.ts` used to hold a second
 * copy of. A registry's per-file map is the thing a person edits when they
 * write a verdict, so it is the thing the per-rule total has to come from;
 * anything else is a restatement, and this repository has replaced several of
 * those with a derivation for exactly the reason this one was replaced.
 */
export function registryTotals(
  triaged: readonly TriagedRule[] = TRIAGED_RULES,
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const rule of triaged) {
    let sum = 0;
    for (const count of rule.expected.values()) sum += count;
    totals.set(rule.rule, (totals.get(rule.rule) ?? 0) + sum);
  }
  return totals;
}
