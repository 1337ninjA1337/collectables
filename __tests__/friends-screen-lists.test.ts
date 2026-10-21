import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * `app/friends.tsx`, read for the first time.
 *
 * It was named as unread in three suggestion rounds while the people screen,
 * the search sheet and the social provider were read four times between them.
 * Reading it found both of the defects those surfaces had already had fixed —
 * a load flag that could stay set, and a developer tripwire that takes the
 * screen down with nothing recorded — and one the provider owed it: the
 * friends tab counts relationships the provider derives, and those derivations
 * carried profiles an admin had deleted.
 *
 * Source reads rather than a render: this screen reaches expo-router, the chat
 * context, the social context and `SwipeTabs`, and nothing in this tree mounts
 * it. The provider's half IS run — `social-provider-mounted.test.ts` — and
 * each case below names the behaviour it stands in for.
 */
const CODE = stripComments(readRepoFile("app/friends.tsx"));

describe("the skeleton cannot outlive the load it is standing in for", () => {
  // Removing your last friend while its profile fetch was in flight cancelled
  // the `.finally` (the cleanup had already set `active` false) and re-ran the
  // effect into an early `return`, so the flag stayed true: a skeleton with no
  // request behind it, and no empty state to get out of it, on the screen
  // whose empty state is the one that sends you to go and find people.
  it("clears the friends flag on an emptied list, not only on a resolve", () => {
    assert.match(
      CODE,
      /const ids = \[\.\.\.friends, \.\.\.incomingRequestUserIds\];\s*if \(ids\.length === 0\) \{\s*setLoadingFriends\(false\);\s*return;\s*\}/,
    );
  });

  it("clears the following flag the same way, in the same window", () => {
    assert.match(
      CODE,
      /if \(following\.length === 0\) \{\s*setLoadingFollowing\(false\);\s*return;\s*\}/,
    );
  });

  it("still clears both on a resolve and on a reject, behind the cancellation flag", () => {
    // The two paths that already worked, kept honest: a late `.finally` from a
    // superseded run must not clear a flag the current run set.
    assert.equal(
      CODE.split(".finally(() => { if (active) setLoading").length - 1,
      2,
      "one per tab, and neither may lose its `active` guard",
    );
    assert.equal(CODE.split(".catch(() => {})").length - 1, 2);
  });

  it("shows the skeleton only while there is nothing else to show", () => {
    // Rows beat the skeleton, which is the order `app/people.tsx` landed on
    // 2026-10-19: a list that still answers must not be replaced by a
    // skeleton because a refresh is in flight.
    assert.match(
      CODE,
      /loadingFriends && friendProfiles\.length === 0 && requestProfiles\.length === 0 \?/,
    );
    assert.match(CODE, /loadingFollowing && followingProfiles\.length === 0 \?/);
  });
});

describe("the tripwire reports before it fires", () => {
  // `app/people.tsx`' identical `throw` got a `captureException` on 2026-10-19
  // and this one did not. It fires inside an `onAction` during a press: in dev
  // it surfaces loudly, and in production it takes the screen down with
  // nothing recorded anywhere.
  it("captures the follow case before throwing it", () => {
    assert.match(
      CODE,
      /captureException\(new Error\("friends screen has no follow action"\), \{\s*scope: "friends\.runRelationshipAction",\s*extra: \{ action \},\s*\}\);\s*throw new Error\("friends screen has no follow action"\);/,
    );
  });

  it("keeps the throw, because the report is not the point of it", () => {
    // A table edit that gave a tab a button this screen cannot service has to
    // be loud for a developer. The capture is what makes it findable in
    // production too.
    assert.match(CODE, /import \{ captureException \} from "@\/lib\/sentry";/);
    assert.equal(
      CODE.split('throw new Error("friends screen has no follow action")').length - 1,
      1,
      "one throw, reported once — a second of either is a case nobody decided",
    );
    assert.equal(
      CODE.split('captureException(new Error("friends screen has no follow action")').length - 1,
      1,
    );
  });

  it("sends only the closed-set label the allow-list permits", () => {
    // `extra` takes four names, each a member of a union this repo declares —
    // never a value a user or a row supplied. `action` is a
    // `RelationshipActionId`.
    assert.ok(!/extra: \{ (profileId|id|username|email)/.test(CODE), "a user-supplied value in extras");
  });
});

describe("the three lists it renders agree with the counts beside them", () => {
  /**
   * The screen maps ids to profiles and drops what does not resolve, so a
   * tombstoned id is invisible in the LIST and was still counted: the friends
   * tab's "(n)" is `incomingRequestUserIds.length`, and `app/index.tsx` renders
   * `friends.length` and `following.length` as summary numbers. The provider
   * owes the screen lists that cannot contain one — `social-provider-mounted
   * .test.ts` runs that half.
   */
  const PROVIDER = stripComments(readRepoFile("lib/social-context.tsx"));

  it("takes its tab counts from the provider's lists rather than re-deriving", () => {
    assert.match(CODE, /incomingRequestUserIds\.length > 0 \? ` \(\$\{incomingRequestUserIds\.length\}\)` : ""/);
    assert.match(CODE, /dotHighlight=\{incomingRequestUserIds\.length > 0 \? "friends" : undefined\}/);
  });

  it("the provider drops a pair naming a deleted profile before it derives anything", () => {
    assert.match(
      PROVIDER,
      /const pairs = friendRequests\.filter\(\s*\(request\) =>\s*!isProfileDeleted\(request\.fromUserId\) && !isProfileDeleted\(request\.toUserId\),\s*\);/,
    );
    assert.equal(
      PROVIDER.split("for (const request of pairs)").length - 1,
      2,
      "both passes read the filtered list, or `mutual` and `incoming` disagree",
    );
  });

  it("the provider's follow list is filtered on the way out and whole on disk", () => {
    assert.match(
      PROVIDER,
      /const visibleFollowing = useMemo\(\s*\(\) => following\.filter\(\(id\) => !isProfileDeleted\(id\)\),/,
    );
    assert.match(PROVIDER, /following: visibleFollowing,/);
    assert.match(
      PROVIDER,
      /JSON\.stringify\(\{ following, myProfile: myProfileOverride \}\)|JSON\.stringify\(\{\s*following,/,
      "the persisted blob must write the stored list, not the filtered view",
    );
  });

  it("states the rule once rather than in every list that depends on it", () => {
    // `visibleSocialCollections` carried its own tombstone term until both
    // sets stopped being able to hold one. Three statements of one rule is how
    // two of them come to disagree.
    assert.match(
      PROVIDER,
      /followingIds\.has\(collection\.ownerUserId\) \|\| friendIds\.has\(collection\.ownerUserId\)/,
    );
    assert.equal(
      PROVIDER.split("isProfileDeleted(collection.ownerUserId)").length - 1,
      0,
      "the social-collection filter re-states a rule its inputs already carry",
    );
  });
});
