import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * What the home screen rebuilds on every render, and what it stopped
 * rebuilding.
 *
 * `ownedCollections` was memoised on 2026-09-10 because a ref had to point at
 * a stable array; the three derivations beside it were flagged in the same
 * round and left alone, since none of them was blocking anything. That is the
 * shape of a performance note that never gets done — it is nobody's bug until
 * somebody's list is long.
 *
 * The one that is actually worth a hook is `friendCollections`. It built a
 * `Set` AND filtered the whole collection list, and inside that filter it
 * scanned `friends` with `.includes` once per row: the cost was friends ×
 * collections, on a screen that re-renders on every tab swipe, every pull to
 * refresh, and every keystroke anywhere in the provider tree above it.
 *
 * `myProfile` is deliberately NOT memoised and the comment beside it says why,
 * which is what this file pins: `getMyProfile` is built inside the context
 * value object, so a memo keyed on it would recompute on exactly the renders
 * it already does. A rule that just counted un-memoised derivations would
 * demand that one too, and be wrong.
 *
 * Structural, because `app/index.tsx` pulls expo-router and react-native —
 * the same shape `keyboard-reorder-actions.test.ts` uses for this screen.
 */

const SRC = readRepoFile("app/index.tsx");
const CODE = stripComments(SRC);

/**
 * The dep array of a named `useMemo`, as a SET of names.
 *
 * The first version of this file matched `}, [collections,
 * sharedWithMeCollections, friends]);` as a literal, which asks a question
 * about formatting: reordering the deps is a no-op for React and turned the
 * suite red, while adding a fourth dep passed silently if it happened to land
 * elsewhere in the file. What matters is WHICH names the memo re-runs on, so
 * that is what this reads.
 */
function depsOf(name: string): Set<string> {
  const open = CODE.indexOf(`const ${name} = useMemo(`);
  assert.ok(open > 0, `${name} must be a useMemo in app/index.tsx`);
  // Walk to the `useMemo(` call's own closing paren, so this reads a memo whose
  // body is a block (`}, [deps])`) and one whose body is a single expression
  // (`() => select(...), [deps])`) the same way.
  let depth = 0;
  let close = -1;
  for (let i = CODE.indexOf("(", open); i < CODE.length; i += 1) {
    if (CODE[i] === "(") depth += 1;
    else if (CODE[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  assert.ok(close > open, `${name}'s useMemo call must be closed`);
  const call = CODE.slice(open, close);
  const deps = call.slice(call.lastIndexOf("["), call.lastIndexOf("]"));
  return new Set(
    deps
      .slice(1)
      .split(",")
      .map((dep) => dep.trim())
      .filter(Boolean),
  );
}

describe("the home screen's friend-collection list", () => {
  it("is derived once per input rather than once per render", () => {
    assert.match(CODE, /const friendCollections = useMemo\(/);
  });

  it("depends on exactly the three lists it reads", () => {
    assert.deepEqual(
      depsOf("friendCollections"),
      new Set(["collections", "sharedWithMeCollections", "friendIds"]),
    );
  });

  it("is declared above the early return, or it is a conditional hook", () => {
    // `if (!ready)` returns a skeleton, and a hook below it runs on some
    // renders and not others — which React treats as a different component.
    const memo = CODE.indexOf("const friendCollections = useMemo(");
    const early = CODE.indexOf("if (!ready)");
    assert.ok(memo > 0 && early > 0, "both anchors must be present");
    assert.ok(memo < early, "the memo must be declared above the early return");
  });

  it("hands the Set to the selector rather than building its own", () => {
    // The screen used to do `new Set(friends)` inside the memo, and so did
    // every other consumer that noticed the scan. One Set per caller of a list
    // that changes when somebody accepts a friend request is the thing
    // `friendIds` retires; a local rebuild here would quietly bring it back.
    assert.match(CODE, /const \{[^}]*\bfriendIds\b[^}]*\} = useSocial\(\);/);
    assert.doesNotMatch(CODE, /new Set\(friends\)/);
    assert.doesNotMatch(CODE, /friends\.includes\(/);
  });

  it("states the rule nowhere, because a tested helper states it", () => {
    // The filter body and the shared-with-me Set moved into
    // `selectFriendCollections` once `app/collections-feed.tsx` turned out to
    // answer the same question with a narrower list. That screen is gone and
    // the helper stayed: what is left here is the call, and
    // `friend-collections-selector.test.ts` owns the rule.
    assert.match(CODE, /selectFriendCollections\(collections, friendIds, sharedWithMeCollections\)/);
    assert.doesNotMatch(CODE, /const sharedWithMeIds = new Set\(/);
    assert.doesNotMatch(CODE, /friendIds\.has\(collection\.ownerUserId\)/);
  });
});

describe("the home screen's profile lookup", () => {
  it("is left un-memoised on purpose, and says so", () => {
    // The honest half of the sweep. `getMyProfile` is rebuilt with the context
    // value, so a memo keyed on it recomputes whenever that value changes —
    // which is every render this screen was doing the work on anyway.
    assert.match(CODE, /const myProfile = getMyProfile\(\);/);
    assert.doesNotMatch(CODE, /myProfile = useMemo\(/);
    assert.match(
      SRC,
      /Not memoised, deliberately/,
      "an un-memoised derivation beside two memoised ones needs a reason written down",
    );
  });
});
