import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { balancedInner } from "@/lib/balanced-source";

import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * One React effect may write at most ONE AsyncStorage key.
 *
 * `CollectionsProvider` wrote five from a single effect whose dependency array
 * listed all five states. `useEffect` fires when ANY dependency changes, so
 * adding one item re-serialised the followed-id list and both offline queues,
 * and a cloud delta that touched only collections still rewrote the items blob
 * — the largest `JSON.stringify` in the app, run four extra times for nothing.
 *
 * That was also the quiet end of a contract shipped one commit earlier. The two
 * cloud merges return the local array BY REFERENCE when a re-read row changed
 * nothing, precisely so the overlap cursor's re-read costs one query instead of
 * a re-render and a storage write. Under a shared effect the unchanged
 * reference bought nothing: a sibling blob's change wrote the unchanged one
 * anyway. `usePersistedBlob` fixed the five call sites; this is the rule, so a
 * sixth blob cannot rejoin the batch and so the next provider does not invent
 * it again.
 *
 * `__tests__/use-persisted-blob.test.ts` pins the hook and the provider's
 * adoption of it. This sweep is the tree-wide half, and it deliberately does
 * NOT require `usePersistedBlob`: `social-context.tsx` writes three keys from
 * three separate effects and two of them serialise an object literal built in
 * the effect body, which the hook's reference-identity dependency would turn
 * into a write on every render. One key per effect is the rule; the hook is one
 * way to satisfy it.
 *
 * WHY A SWEEP AND NOT A `lint:all` GUARD. The offence needs a balanced,
 * quote-aware read of a call's argument list rather than a line pattern, and
 * every existing guard's scanner is a regex over stripped source. This file
 * used to end by saying a second rule needing the same reader would be the
 * moment it earned a module; a fourth one arrived and it is
 * `lib/balanced-source.ts`, which is where the reader's limits are now stated
 * once instead of in two of the three copies.
 */

/** What a single effect wrote, when it wrote more than one key. */
type Offence = {
  readonly file: string;
  readonly line: number;
  readonly writes: number;
};

const EFFECT = /\buse(?:Layout)?Effect\s*\(/g;
const WRITE = /\bAsyncStorage\s*\.\s*(?:setItem|multiSet|mergeItem|multiMerge)\s*\(/g;

function countMatches(text: string, pattern: RegExp): number {
  // A fresh RegExp per call: `g` patterns carry `lastIndex`, and a shared one
  // reused across a filter skips every other subject.
  return text.match(new RegExp(pattern.source, "g"))?.length ?? 0;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Every effect in `source`, with the number of AsyncStorage keys it writes. */
function scanEffects(file: string, source: string): Offence[] {
  const found: Offence[] = [];
  const effects = new RegExp(EFFECT.source, "g");
  for (
    let match = effects.exec(source);
    match !== null;
    match = effects.exec(source)
  ) {
    const open = match.index + match[0].length - 1;
    const args = balancedInner(source, open, "(", ")");
    if (args === null) continue;
    found.push({ file, line: lineOf(source, match.index), writes: countMatches(args, WRITE) });
    // Resume past this call so a nested effect is not read twice.
    effects.lastIndex = open + args.length + 2;
  }
  return found;
}

/** Every effect that writes more than one AsyncStorage key. */
function findBatchedPersistEffects(file: string, source: string): Offence[] {
  return scanEffects(file, source).filter((effect) => effect.writes > 1);
}

/**
 * The offender the sweep cannot find in the tree, because the tree no longer
 * contains one. A ban is satisfied by a pattern that has stopped matching, so
 * the scanner flags its own probe before it is allowed to call the tree clean.
 */
const PROBE = `
  useEffect(() => {
    if (!ready || !user) return;
    Promise.all([
      AsyncStorage.setItem(collectionsKey(user.id), JSON.stringify(localCollections)),
      AsyncStorage.setItem(itemsKey(user.id), JSON.stringify(localItems)),
    ]).catch(() => undefined);
  }, [localCollections, localItems, ready, user]);
`;

const FILES = sourceFiles();

describe("one AsyncStorage key per effect", () => {
  it("flags its own probe — the offence the tree no longer contains", () => {
    const flagged = findBatchedPersistEffects("<probe>", PROBE);
    assert.equal(flagged.length, 1, "the scanner must still recognise a batched persist effect");
    assert.equal(flagged[0].writes, 2);
  });

  it("does not flag an effect that writes exactly one key", () => {
    assert.deepEqual(
      findBatchedPersistEffects(
        "<probe>",
        `useEffect(() => {
           if (!ready || !storageKey) return;
           AsyncStorage.setItem(storageKey, JSON.stringify(store)).catch(() => undefined);
         }, [ready, storageKey, store]);`,
      ),
      [],
    );
  });

  it("is not fooled by a parenthesis inside a string literal", () => {
    // `balancedParens` reading the `")"` as a closer would end the effect at
    // the first write and report nothing — the silent direction of the bug.
    const flagged = findBatchedPersistEffects(
      "<probe>",
      `useEffect(() => {
         AsyncStorage.setItem(")", a);
         AsyncStorage.setItem("b", b);
       }, [a, b]);`,
    );
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].writes, 2);
  });

  it("reads real effects out of the tree, not an empty walk", () => {
    assert.ok(FILES.length > 0, "an empty walk satisfies any absence perfectly");
    const effects = FILES.flatMap((relative) => scanEffects(relative, sourceCode(relative)));
    // A floor, not a count: the number moves with every screen added. What it
    // refuses is the shape where `balancedParens` starts returning null (an
    // unterminated literal after a stripper change) and the sweep quietly reads
    // a handful of effects instead of every one of them. 91 today.
    assert.ok(
      effects.length >= 60,
      `the walk read only ${String(effects.length)} effects — the argument reader is dropping calls it should be reading`,
    );
    // The clean verdict below is only worth anything if the reader can see a
    // persist effect at all: a scanner that matched no write in any effect
    // would report the same empty offender list over a tree full of them.
    const persisting = effects.filter((effect) => effect.writes === 1);
    assert.ok(
      persisting.length >= 5,
      `only ${String(persisting.length)} effects were seen writing a key — the argument reader is not reaching the writes it must count`,
    );
  });

  it("no effect in the tree writes more than one key", () => {
    const offences = FILES.flatMap((relative) =>
      findBatchedPersistEffects(relative, sourceCode(relative)),
    );
    assert.deepEqual(
      offences.map((offence) => `${offence.file}:${String(offence.line)} (${String(offence.writes)} keys)`),
      [],
      "an effect that writes N keys rewrites all N whenever any one of its dependencies changes — give each key its own effect (lib/use-persisted-blob.ts) so an unchanged value writes nothing",
    );
  });
});
