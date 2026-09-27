/**
 * All 31 `react-hooks/set-state-in-effect` findings, read and decided.
 *
 * The rule's complaint is that a `setState` in an effect BODY renders twice
 * for one change, and in the wrong place loops. It is the second-largest error
 * class `npm run lint` reports and no suggestion list had ever carried it, so
 * the first deliverable was never a fix: a blanket rewrite would have been 31
 * behaviour changes nobody reviewed, and several of these are the shape React's
 * own docs bless.
 *
 * This registry is what was read. One site per entry, keyed by the CALL as the
 * file spells it rather than by a line number, so it stays true across an edit
 * above it and fails loudly when the line it describes is gone.
 *
 * ## What the reading found
 *
 * One bug, and it was a request loop rather than a render loop.
 * `app/listing/[id].tsx` guarded its fetch on `fetchingRemote` and had
 * `fetchingRemote` in the effect's own dependency list: set true, re-run,
 * bail; fetch resolves `null` for a listing that does not exist; set false,
 * re-run, listing still missing, ask again. Forever, one network round trip
 * per turn, the screen flickering between a skeleton and "listing not found".
 * The two screens next door — `app/collection/[id].tsx` and
 * `app/item/[id].tsx` — do the same read and never had it, because neither
 * puts its loading flag in its own dependency list. That is the whole
 * difference, and it is the one this rule would have caught on the day it was
 * written.
 *
 * Seven more are the bail-out updater — `setX(prev => prev.length === 0 ? prev
 * : [])` — which is somebody having already thought about exactly this: React
 * drops a re-render when an updater returns the value it was given, so the
 * cascade the rule warns about cannot happen. The rule does not evaluate
 * updaters and cannot know.
 *
 * Fifteen are an effect telling React about something OUTSIDE React — a fetch
 * starting, a subscription settling, storage answering — which is what effects
 * are for; the extra render is the point, and in none of them does the flag
 * feed the dependency list that re-runs the effect.
 *
 * Four are `open`, and they are the interesting ones: state derived from a
 * prop, which React's docs say to compute during render or key a remount on
 * instead. Each would be a behaviour change (a draft that stops being
 * clobbered mid-edit is a different screen), so each is a decision, and the
 * decision is not this pass's to make.
 *
 * ## Why it is a registry and not prose
 *
 * The next person to run `npm run lint` sees 31 errors and no way to tell
 * which were looked at. A list in a task file goes stale silently. This one
 * cannot: every entry names a line of real code, and
 * `set-state-in-effect-triage.test.ts` holds each against the file it claims
 * to be in.
 */

import { stripComments } from "./strip-comments";

/**
 * What the site IS, which is the question the rule cannot ask.
 *
 * The shape decides the verdict almost everywhere, which is the argument for
 * naming shapes rather than writing 31 paragraphs.
 */
export type SetStateInEffectShape =
  /** `setX(prev => prev.length === 0 ? prev : [])` — React bails out, no cascade. */
  | "bail-out-updater"
  /** A flag set around an async read, never in the effect's own dependency list. */
  | "loading-flag"
  /** Derived state cleared when the input that produced it goes away. */
  | "reset-on-input"
  /** State reset when a modal or sheet opens, keyed on `visible`. */
  | "open-reset"
  /** An updater that reads the previous value to decide the next one. */
  | "state-machine-updater"
  /** Not a `setState` at the call site — the rule followed the callee. */
  | "indirect"
  /** State kept in step with a prop, which is the shape React's docs argue with. */
  | "sync-to-prop"
  /** A fixture that models the failure so a harness can prove it catches it. */
  | "fixture"
  /** The effect's own state variable is in its dependency list. */
  | "self-feeding-dep";

export type SetStateInEffectVerdict =
  /** Correct as written; the rule cannot decide it and a change would be a regression. */
  | "keep"
  /** Was wrong, and is not any more. The entry records what it became. */
  | "fixed"
  /** A real question nobody has answered. Changing it changes behaviour. */
  | "open";

export interface SetStateInEffectSite {
  /** Repo-relative path. */
  readonly file: string;
  /** The call, exactly as the file spells it, comments stripped. */
  readonly call: string;
  /**
   * Which of that call's occurrences this entry is about, 1-indexed.
   *
   * Required when the file spells the same call more than once, and omitted
   * when it does not — six of these do, because "clear the search box" and
   * "stop the spinner" are lines a file has reason to write twice. An index is
   * the honest key there: it is exact, it is checkable, and when somebody adds
   * a sixth `setReady(true)` above this one the suite says so rather than
   * matching the wrong line in silence.
   */
  readonly occurrence?: number;
  readonly shape: SetStateInEffectShape;
  readonly verdict: SetStateInEffectVerdict;
  /** One sentence. Why this verdict and not another. */
  readonly why: string;
}

/**
 * The 31, in the order `npx eslint .` reported them on 2026-09-27.
 */
export const SET_STATE_IN_EFFECT_SITES: readonly SetStateInEffectSite[] = [
  {
    file: "__tests__/mount-provider-harness.test.ts",
    call: "setCount((previous) => previous + 1);",
    shape: "fixture",
    verdict: "keep",
    why: "`Runaway` is an effect with no dependency array that sets the state it renders — the harness's proof that it detects a runaway rather than hanging on one. The rule is right, and being right about it is what the fixture is for.",
  },
  {
    file: "app/chat/[id].tsx",
    call: "setTypingUserIds([]);",
    shape: "reset-on-input",
    verdict: "keep",
    why: "Clears the typing indicator when the chat closes or access is withdrawn, then returns without subscribing; the state it sets is not in the dependency list.",
  },
  {
    file: "app/collection/[id].tsx",
    call: "setItemFilters((current) => ({ ...current, sort: restoredSort }));",
    shape: "sync-to-prop",
    verdict: "open",
    why: "A one-shot restore of a persisted sort, guarded by a ref that a separate effect clears on `params.id`. It works, and it is two effects and a ref where React's docs would key a remount or resolve the preference before the screen mounts — which is a routing change, not a rewrite of this line.",
  },
  {
    file: "app/collection/[id].tsx",
    call: "setLoadingRemote(true);",
    shape: "loading-flag",
    verdict: "keep",
    why: "Deps are `[localCollection, params.id]`; the flag is not among them, so the fetch starts once. This is the shape `app/listing/[id].tsx` got wrong, written correctly.",
  },
  {
    file: "app/friends.tsx",
    call: "setLoadingFriends(true);",
    shape: "loading-flag",
    verdict: "keep",
    why: "Set before `ensureProfilesLoaded`, cleared in its `finally` behind an `active` flag; not in the dependency list.",
  },
  {
    file: "app/friends.tsx",
    call: "setLoadingFollowing(true);",
    shape: "loading-flag",
    verdict: "keep",
    why: "The same effect shape for the second tab's list, with the same cancellation flag.",
  },
  {
    file: "app/item/[id].tsx",
    call: "setLoadingRemote(true);",
    shape: "loading-flag",
    verdict: "keep",
    why: "Deps are `[localItem, params.id]`. Same correct shape as the collection screen.",
  },
  {
    file: "app/listing/[id].tsx",
    call: "setFetchingRemote(true);",
    shape: "self-feeding-dep",
    verdict: "fixed",
    why: "Guarded on `fetchingRemote` with `fetchingRemote` in its own dependency list, so a listing that does not exist was re-fetched forever. It is guarded on an `askedForRef` keyed by listing id now, and the flag is out of the deps.",
  },
  {
    file: "app/people.tsx",
    call: "setSearchResults([]);",
    shape: "reset-on-input",
    verdict: "keep",
    why: "Clears remote matches when the debounced query empties, then returns; the results are not in the dependency list.",
  },
  {
    file: "app/people.tsx",
    call: "void loadPage(page);",
    shape: "indirect",
    verdict: "keep",
    why: "Not a `setState` — the rule followed `loadPage` into the context. Paging on a page change is what the effect is for.",
  },
  {
    file: "app/profile/[id].tsx",
    call: 'setBioDraft(activeProfile.bio === DEFAULT_EN_PROFILE_BIO ? t("defaultProfileBio") : activeProfile.bio);',
    shape: "sync-to-prop",
    verdict: "open",
    why: "Two edit drafts kept in step with the loaded profile. It is the textbook case for deriving during render, and it is also the one that changes behaviour visibly: a realtime profile update currently overwrites what the user is typing, and stopping that is a decision about which of the two wins.",
  },
  {
    file: "components/item-filters.tsx",
    call: "setDraft(filters);",
    shape: "sync-to-prop",
    verdict: "open",
    why: "The sheet's draft follows the caller's committed filters so that a chip cleared outside the sheet is visible when it reopens; the file argues its dependency choice at length and the argument holds. What it does not argue is the alternative React names — a `key` on the sheet — which would make the reopen a remount and delete the effect.",
  },
  {
    file: "components/photo-lightbox.tsx",
    call: "setIndex(clampedInitial);",
    shape: "open-reset",
    verdict: "keep",
    why: "Keyed on `visible`; `index` is not in the dependency list, and the scroll it pairs with has to happen after the Modal mounts its ScrollView.",
  },
  {
    file: "components/search-overlay.tsx",
    call: 'setQuery("");',
    occurrence: 1,
    shape: "open-reset",
    verdict: "keep",
    why: "Clears the previous search when the overlay opens, keyed on `visible` alone.",
  },
  {
    file: "components/search-overlay.tsx",
    call: "setRemoteMatches([]);",
    shape: "reset-on-input",
    verdict: "keep",
    why: "The people-screen shape again: clear the remote matches when the debounced query empties or the filter excludes people, then return.",
  },
  {
    file: "lib/auth-context.tsx",
    call: "setReady(true);",
    occurrence: 1,
    shape: "reset-on-input",
    verdict: "keep",
    why: "No Supabase client configured, so there is no session to wait for and the gate has to open; it returns immediately after, and `ready` is not in the dependency list.",
  },
  {
    file: "lib/chat-context.tsx",
    call: "setStore(EMPTY_CHAT_STORE);",
    shape: "reset-on-input",
    verdict: "keep",
    why: "Signed out: the cached store must not survive into the next account's session, which is the same argument the three lines under it make for the hydration flags.",
  },
  {
    file: "lib/collections-context.tsx",
    call: "setLocalCollections(prev => prev.length === 0 ? prev : []);",
    shape: "bail-out-updater",
    verdict: "keep",
    why: "Already written to bail out: React drops the re-render when an updater returns its argument, so a signed-out provider that is already empty renders once, not twice.",
  },
  {
    file: "lib/collections-context.tsx",
    call: "setSubscribedCollections(prev => prev.length === 0 ? prev : []);",
    occurrence: 2,
    shape: "bail-out-updater",
    verdict: "keep",
    why: "Same bail-out, clearing the subscribed list when there is no user or nothing followed.",
  },
  {
    file: "lib/collections-context.tsx",
    call: "setSubscribedItems(prev => prev.length === 0 ? prev : []);",
    shape: "bail-out-updater",
    verdict: "keep",
    why: "Same bail-out, for the items of those collections.",
  },
  {
    file: "lib/collections-context.tsx",
    call: "setFriendCollections(prev => prev.length === 0 ? prev : []);",
    shape: "bail-out-updater",
    verdict: "keep",
    why: "Same bail-out, for collections visible through friendship.",
  },
  {
    file: "lib/collections-context.tsx",
    call: "setSharedWithMeCollections(prev => prev.length === 0 ? prev : []);",
    shape: "bail-out-updater",
    verdict: "keep",
    why: "Same bail-out, for collections shared by link.",
  },
  {
    file: "lib/premium-context.tsx",
    call: "setReady(false);",
    shape: "loading-flag",
    verdict: "keep",
    why: "Closes the entitlement gate before re-hydrating for a changed account; `ready` is not in the dependency list, and leaving it open across the swap is user A's entitlement answering for user B.",
  },
  {
    file: "lib/social-context.tsx",
    call: "setFollowing(prev => prev.length === 0 ? prev : []);",
    shape: "bail-out-updater",
    verdict: "keep",
    why: "The signed-out reset, bailing out like the five in the collections provider.",
  },
  {
    file: "lib/social-context.tsx",
    call: 'void syncSocial({ kind: "upsert-profile", profile: selfProfile });',
    shape: "indirect",
    verdict: "keep",
    why: "Not a `setState` — the rule followed the queue's enqueue. Pushing the edited profile at the cloud is the effect's whole purpose.",
  },
  {
    file: "lib/social-context.tsx",
    call: "setRemoteProfiles(prev => prev.length === 0 ? prev : []);",
    shape: "bail-out-updater",
    verdict: "keep",
    why: "Clears fetched friend profiles when the friend list empties, bailing out when it is already empty.",
  },
  {
    file: "lib/use-chunked-list.ts",
    call: "setCount(safePageSize);",
    occurrence: 1,
    shape: "sync-to-prop",
    verdict: "open",
    why: "Resets paging when the list or the page size changes, which is right — but it resets on the IDENTITY of `items`, so a caller passing a freshly-built array each render silently pins the list to its first page. Every caller memoizes today. Whether that stays true is a contract this hook does not state or check.",
  },
  {
    file: "lib/use-connection-notice.ts",
    call: "setNotice((previous) => nextConnectionNotice(previous, true));",
    shape: "state-machine-updater",
    verdict: "keep",
    why: "The updater form is deliberate and the header says why: depending on `notice` would re-run the effect on every transition it makes and re-arm the grace timer from the top.",
  },
  {
    file: "lib/use-item-sort-pref.ts",
    call: "setRestored(null);",
    shape: "loading-flag",
    verdict: "keep",
    why: "Clears the previous collection's restored sort before reading storage for the new one; `restored` is not in the dependency list.",
  },
  {
    file: "lib/use-minimum-visible.ts",
    call: "setLingering(false);",
    occurrence: 1,
    shape: "reset-on-input",
    verdict: "keep",
    why: "The spinner is genuinely active, so there is no linger to hold; the effect returns straight after and `lingering` is not among its dependencies.",
  },
  {
    file: "lib/use-reactions.ts",
    call: "setLoading(false);",
    occurrence: 1,
    shape: "loading-flag",
    verdict: "keep",
    why: "No target to read yet, so the bar must stop showing its spinner — the comment above it is about the bug that left one turning for the life of the mount.",
  },
];

/** How many the linter reported, and therefore how many have to be in here. */
export const SET_STATE_IN_EFFECT_TOTAL = 31;

/** One entry's claim that no longer holds. */
export interface TriageProblem {
  readonly file: string;
  readonly call: string;
  readonly problem: "gone" | "ambiguous";
  readonly message: string;
}

/**
 * Every registered call held against the file it claims to be in.
 *
 * `gone` is a line that has been edited or deleted — the entry is describing
 * code that is not there, which is the way a triage rots. `ambiguous` is the
 * opposite failure: the same call appears more than once in the file, so the
 * entry cannot say WHICH one it read. Both are reported rather than one
 * silently standing for the other.
 *
 * Comments are stripped first, because this module and its suite both spell
 * several of these lines out.
 */
export function triageProblems(read: (file: string) => string): TriageProblem[] {
  const problems: TriageProblem[] = [];
  const sources = new Map<string, string>();
  for (const site of SET_STATE_IN_EFFECT_SITES) {
    let code = sources.get(site.file);
    if (code === undefined) {
      code = stripComments(read(site.file));
      sources.set(site.file, code);
    }
    const hits = code.split(site.call).length - 1;
    const wanted = site.occurrence ?? 1;
    if (hits < wanted) {
      problems.push({
        file: site.file,
        call: site.call,
        problem: "gone",
        message:
          hits === 0
            ? `${site.file} no longer contains \`${site.call}\` — the entry describes code that has been edited or removed, so its verdict is about nothing.`
            : `${site.file} contains \`${site.call}\` ${hits} time(s), and the entry is about occurrence ${wanted} — the one it read has gone.`,
      });
    } else if (hits > 1 && site.occurrence === undefined) {
      problems.push({
        file: site.file,
        call: site.call,
        problem: "ambiguous",
        message: `${site.file} contains \`${site.call}\` ${hits} times and the entry names no occurrence — it cannot say which one it read.`,
      });
    }
  }
  return problems;
}

/** How many sites carry each verdict. */
export function verdictCounts(): Record<SetStateInEffectVerdict, number> {
  const counts: Record<SetStateInEffectVerdict, number> = { keep: 0, fixed: 0, open: 0 };
  for (const site of SET_STATE_IN_EFFECT_SITES) counts[site.verdict] += 1;
  return counts;
}
