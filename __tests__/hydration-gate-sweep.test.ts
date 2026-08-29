import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { balancedEnd } from "@/lib/balanced-source";

import { assertNoOffenders } from "./helpers/offence-sweep";
import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * A provider that READS AsyncStorage on mount and WRITES it from an effect must
 * gate the write on the read having worked.
 *
 * ## The bug, five times
 *
 * Every one of these providers hydrated under a `try` whose `catch` installed a
 * default and whose `finally` flipped `ready` — and `ready` is what enables the
 * persist effect. So a failed read put the DEFAULT into state and then wrote it
 * over the user's blob, permanently, because that write succeeds:
 *
 *   - `collections-context` wrote the DEMO SEED DATA over a real account, and
 *     the trigger was an offline launch (two of its seven hydrate sources are
 *     network calls with no `.catch`);
 *   - `social-context` wrote an empty follow list over the real one;
 *   - `premium-context` wrote "free" over a paying user's entitlement;
 *   - `marketplace-context` emptied the cache its own offline fallback exists
 *     for;
 *   - `chat-context` wrote an empty pending queue over messages the user had
 *     sent OFFLINE and nothing upstream holds — found by writing this sweep,
 *     after the other five were fixed by hand one at a time.
 *
 * The last one is the point. FOUR fixes by inspection missed it, and the one
 * they missed is the only provider whose blob contains data no server has.
 *
 * `diagnostics-context` and `i18n-context` are deliberately NOT in this class,
 * and the first draft of this sweep flagged both: their writes are
 * user-initiated, so there is no hydrate-then-persist cycle to gate and gating
 * one would drop a choice somebody made on purpose. Their read failures were
 * worth fixing for other reasons and this is not the rule that covers them.
 *
 * ## Why this is a shape and not a list
 *
 * Nothing in the storage rules could see any of it. They ask whether a rejected
 * read or write is handled and reported; this is a SUCCESSFUL WRITE OF THE
 * WRONG THING, from a catch arm doing exactly what it was written to do. The
 * only thing the six have in common is the shape, so the shape is the rule.
 */

const READS = /\bAsyncStorage\s*\.\s*(?:getItem|multiGet)\s*\(/;
const WRITE = /\bAsyncStorage\s*\.\s*(?:setItem|multiSet|mergeItem|multiMerge)\s*\(/;

/** The gate is absent from the whole file — the second conjunct of the rule. */
const NO_GATE = /^(?![\s\S]*hydrationSafeToPersist)[\s\S]*$/;

/**
 * The offence, named so the sweep and any case about its holes share it.
 *
 * A conjunction rather than one pattern: "reads AsyncStorage" AND "names the
 * gate nowhere". The walk has already established that the file persists from
 * an effect, which is the half a regex over a whole file cannot state.
 */
const UNGATED_PERSIST = [READS, NO_GATE];

/**
 * Providers with no account to change, and therefore nothing to clear a gate
 * for.
 *
 * `marketplace-context` holds ONE global listings cache under a key with no
 * user id in it, so there is no sign-out that could persist one account's
 * emptied state over another's.
 */
const NOT_USER_SCOPED = ["lib/marketplace-context.tsx"];

/**
 * A provider, for this rule: a module that reads AsyncStorage on mount and
 * writes it FROM AN EFFECT.
 *
 * The second half is the whole of it, and the first draft of this sweep got it
 * wrong — it asked only "reads and writes", and flagged `i18n-context` and
 * `diagnostics-context`, whose writes are USER-INITIATED. A language the user
 * just picked and a diagnostics toggle they just flipped are values to persist
 * whatever the last read did; there is no hydrate-then-persist cycle there to
 * gate, and gating one would drop a choice the user made on purpose.
 *
 * `usePersistedBlob(` counts as an effect write — it IS an effect, and
 * `collections-context` has no `setItem` of its own, so a rule that only saw
 * `AsyncStorage.setItem` would have missed the module this class was found in.
 */
function persistsFromAnEffect(code: string): boolean {
  if (/\busePersistedBlob\s*\(/.test(code)) return true;
  const effect = /\buseEffect\s*\(/g;
  for (let m = effect.exec(code); m !== null; m = effect.exec(code)) {
    const open = m.index + m[0].length - 1;
    const end = balancedEnd(code, open, "(", ")");
    // An unreadable call contributes nothing rather than a truncated span —
    // the silent direction for a sweep asserting an absence.
    if (end !== null && WRITE.test(code.slice(open, end))) return true;
  }
  return false;
}

function hydratingProviders(): string[] {
  return sourceFiles().filter((relative) => {
    // Comments stripped, in the direction that hides a hole rather than
    // inventing one: a provider must not satisfy this by NAMING the gate in a
    // comment explaining why it has none.
    const code = sourceCode(relative);
    // `useState` separates a provider from a helper module: the ten `lib/*.ts`
    // storage helpers read and write the same keys and have no hydrate cycle.
    return /\buseState\s*[(<]/.test(code) && READS.test(code) && persistsFromAnEffect(code);
  });
}

describe("every hydrating provider gates its persist", () => {
  it("finds the providers, so the sweep below is not vacuous", () => {
    // A sweep asserting an absence is satisfied perfectly by a walk that
    // stopped matching. Five is the count the fixes were made against; a floor
    // rather than an equality, because a sixth provider is a real outcome and
    // this case is about the reader still working.
    const found = hydratingProviders();
    assert.ok(
      found.length >= 5,
      `only ${String(found.length)} hydrating providers found (${found.join(", ")}) — the reader stopped matching`,
    );
  });

  it("names the five this rule was written against", () => {
    // Listed, so the day one of them stops hydrating from storage somebody
    // deletes a name here rather than wondering why the count moved.
    const found = hydratingProviders();
    for (const relative of [
      "lib/chat-context.tsx",
      "lib/collections-context.tsx",
      "lib/marketplace-context.tsx",
      "lib/premium-context.tsx",
      "lib/social-context.tsx",
    ]) {
      assert.ok(found.includes(relative), `${relative} must be swept`);
    }
  });

  it("no provider persists what a failed hydrate put in state", () => {
    assertNoOffenders({
      // Both conjuncts, so the offence is "hydrates and persists WITHOUT a
      // gate" rather than two rules a reader has to hold together.
      rule: UNGATED_PERSIST,
      files: hydratingProviders(),
      read: (relative) => sourceCode(relative),
      subject: "providers",
      what: "read AsyncStorage on mount and write it back without gating the write on the read having worked — a failed hydrate then persists its default over the user's blob (see lib/stored-blob.ts)",
    });
  });

  it("the gate starts false in every provider that declares it", () => {
    // `useState(true)` would make the whole thing decorative: the first render
    // enables the persist effect before any hydrate has run, which is the state
    // the gate exists to refuse.
    const problems = hydratingProviders().filter((relative) => {
      const code = sourceCode(relative);
      return !/const \[hydrationSafeToPersist, setHydrationSafeToPersist\] = useState\(false\)/.test(
        code,
      );
    });
    assert.deepEqual(
      problems,
      [],
      `these providers declare the gate open before anything has read the store: ${problems.join(", ")}`,
    );
  });

  it("the gate is cleared when the account changes", () => {
    // Signed out is not "hydrated and safe". Without this the cleared state a
    // sign-out installs is persisted over whatever the NEXT account has on
    // disk — the same bug with a different trigger. The exception is named in
    // `NOT_USER_SCOPED` rather than spelled here.
    const userScoped = hydratingProviders().filter(
      (relative) => !NOT_USER_SCOPED.includes(relative),
    );
    const problems = userScoped.filter(
      (relative) => !/setHydrationSafeToPersist\(false\)/.test(sourceCode(relative)),
    );
    assert.deepEqual(
      problems,
      [],
      `these providers never close the gate, so it cannot be closed on sign-out: ${problems.join(", ")}`,
    );
  });
});
