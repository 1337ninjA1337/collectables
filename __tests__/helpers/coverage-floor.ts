/**
 * The two kinds of floor a derived sweep puts under itself, told apart.
 *
 * A structural case that walks the tree and asserts something about what it
 * found has one failure mode that is worse than being wrong: matching nothing
 * and reporting clean. `assert.ok(found.length >= N)` is the guard against it,
 * and this repository now has ninety-odd of them. They look identical and they
 * are not — the number means one of two different things, and which one decides
 * what a reader should do when the count moves.
 *
 * A MEASURED floor is the count the walk finds today. It catches a pattern that
 * stopped matching, and nothing else: growth is silent, and a shrink of one is
 * a failure. Right for a walk over a set that only changes when somebody
 * deliberately changes it.
 *
 * An ARGUED floor is a number with a reason that is not "this is what we have".
 * It sits below the current count on purpose, so ordinary growth does not have
 * to be ratified by editing a test, and it holds the sweep to a coverage claim
 * that was decided rather than observed — "no less than the hand-written list
 * this replaced" is the one that produced this helper.
 *
 * WHY MESSAGE BUILDERS AND NOT ASSERTIONS. An `assertMeasuredFloor(...)` that
 * called `assert.ok` itself would report every failure at this file's line
 * rather than the case's, which is the one thing a reader needs first. The
 * assertion stays at the call site and takes its message from here, so the kind
 * is in the code — greppable, and impossible to leave off — while the failure
 * still points where it happened.
 *
 * The `because` on an argued floor is required, because a number chosen rather
 * than observed is exactly the number that reads as arbitrary six months later.
 * A measured floor needs no such argument: its reason is that it is the count.
 *
 * WHY `what` CARRIES `(s)`. Both messages open "only N <what>", and N is a
 * count that can be one. Written as a bare plural the shared string reads "only
 * 1 probes" on the failure a reader is most likely to meet — a walk that found
 * exactly one of what it wanted — and two call sites had already worked around
 * it by leaving the "(s)" in the output. The marker is now the input: it is
 * dropped when the count is one and becomes "s" otherwise, so "probe(s) read as
 * spawning" prints "1 probe read as spawning" and "0 probes read as spawning".
 * The type requires it, so a bare plural does not compile rather than reaching a
 * reader ungrammatical.
 *
 * WHERE THE RULE ITSELF LIVES. Not here. "exactly one takes the singular, and
 * zero does not" is `plural` in `lib/plural.ts`, written for the six languages
 * the app speaks and argued there at length — zero takes the plural in all
 * three two-form locales, which is why it is not "less than two". A second copy
 * of that comparison in a test helper is the shape this repository keeps
 * retiring, and `lib/audit-baseline.ts` had a third. The marker below is a
 * SPELLING of the two forms, not a rule: it splits "probe(s)" into "probe" and
 * "probes" and asks `plural` which one this count takes.
 */

import { plural } from "@/lib/plural";

/**
 * A noun phrase for the thing being counted, with its head noun marked.
 *
 * `(s)` is the regular case — "module(s) matched the provenance pattern" — and
 * is short for `(|s)`: no suffix at one, "s" otherwise. An irregular noun
 * writes both forms, "advisor(y|ies)", so a phrase that cannot be regularised
 * does not have to be rephrased around the marker.
 */
export type CountedPhrase = `${string}(${string})${string}`;

/**
 * Resolves every marker in the phrase to the form this count takes.
 *
 * A marker with THREE forms is refused rather than truncated. `plural` picks
 * between two, and a phrase written `"(a|b|c)"` would otherwise inflect to "a"
 * or "b" and drop "c" with nothing said — a silent wrong answer in the one
 * string a reader is meant to trust. Three forms is what `slavicPlural` is for,
 * and no message here is written in a language that needs it.
 *
 * The throw lands on the GREEN path, which is where it should: `assert.ok(x, m)`
 * builds `m` whether or not it fires, so a phrase this cannot resolve fails the
 * first run that reaches the line rather than the first run that goes red.
 */
function inflect(what: CountedPhrase, count: number): string {
  return what.replace(/\(([^()]*)\)/g, (_whole, forms: string) => {
    const parts = forms.includes("|") ? forms.split("|") : ["", forms];
    if (parts.length > 2) {
      throw new Error(
        `"${what}" marks a head noun with ${String(parts.length)} forms and this rule picks between two — write "(singular|plural)", or "(s)" for the regular case`,
      );
    }
    return plural(count, parts[0] ?? "", parts[1] ?? "");
  });
}

/**
 * A floor that equals what the walk finds today.
 *
 * `assert.ok(modules.length >= 5, measuredFloor(modules.length, 5, "module(s) matching lib/*-provenance"))`
 */
export function measuredFloor(
  count: number,
  floor: number,
  what: CountedPhrase,
): string {
  return `only ${String(count)} ${inflect(what, count)} — the floor of ${String(floor)} is MEASURED (it is the count this walk finds today), so this means the pattern stopped matching rather than that the tree shrank below a target`;
}

/**
 * A floor chosen for a reason, sitting below what the walk finds today.
 *
 * `because` completes "the floor of N is ARGUED: …" — say what the number is,
 * not what the walk does. "no fewer than the six the hand-written list covered"
 * rather than "we need at least six".
 */
export function arguedFloor(
  count: number,
  floor: number,
  what: CountedPhrase,
  because: string,
): string {
  return `only ${String(count)} ${inflect(what, count)} — the floor of ${String(floor)} is ARGUED: ${because}. It sits below the current count on purpose, so a count that has fallen TO it is a real loss of coverage rather than a number needing an update`;
}
