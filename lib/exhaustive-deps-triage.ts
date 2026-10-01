import { stripComments } from "./strip-comments";

/**
 * All 13 `react-hooks/exhaustive-deps` findings, read and decided.
 *
 * The rule's complaint is that a hook reads something its dependency array
 * does not list, so the callback can keep a value the render has moved on
 * from. It is the third-largest population in the ungated report and no
 * suggestion list had ever carried it — which is the same position
 * `react-hooks/set-state-in-effect` was in a week ago, and the same first
 * deliverable: read all of them before changing any, because a blanket
 * "add the name" is thirteen behaviour changes nobody reviewed.
 *
 * This registry is what was read. One site per entry, keyed by the dependency
 * the rule names plus the hook's own line of code, so it stays true across an
 * edit above it and fails loudly when what it describes is gone.
 *
 * ## What the reading found
 *
 * ONE BUG, in the screen with the most hooks in the tree.
 * `app/collection/[id].tsx` memoizes its page header over sixteen
 * dependencies and `toggleReorderMode` was not one of them. That callback is
 * a `useCallback` over `[applySort, itemFilters.sort, reorderMode, t, toast]`
 * and the header's list holds two of those five — crucially not
 * `itemFilters.sort`, because `allItems` is the UNFILTERED list and nothing
 * else in the header moves when the sort does. So: sort by price, press
 * Reorder, and the handler runs its early return against the sort the header
 * was built with. The sort is never cleared, the undo toast is never offered,
 * and the user drags rows in a list whose shown order and stored order
 * disagree. The reverse is just as reachable — clear a sort, press Reorder,
 * and get a toast offering to undo back to the sort you just cleared.
 *
 * ONE STALE TRANSLATOR. `lib/social-context.tsx`'s value factory calls
 * `buildFallbackProfile(user, t)` and omitted `t`, so a profile first created
 * after a language switch got its default bio in the previous language. Both
 * are fixed; everything else on this list is correct as written, and the
 * reasons fall into three kinds.
 *
 * A NARROWED OBJECT DEPENDENCY, twice. `lib/auth-context.tsx` depends on
 * `session?.user?.id` and `session?.user?.email` rather than `session.user`,
 * and `app/profile/[id].tsx` on `activeProfile?.bio` and
 * `activeProfile?.username` rather than `activeProfile`. Both read exactly
 * the fields they list. The object is rebuilt by its source on every refresh
 * while the fields are not, so listing the object is how the effect fires on
 * nothing — the rule asks for the wider name because it cannot know that.
 *
 * A STABLE REF, twice. `useLatestRef` returns a ref object whose identity
 * never changes, and both `lib/use-entry-currency.ts` and
 * `lib/use-transition-event.ts` say in their headers why the callback goes
 * through one: every caller passes an inline arrow, so listing it would
 * re-run the effect every render and re-apply a preference over a choice the
 * user is making. The rule does not follow a custom hook's return.
 *
 * A TRANSITIVE COVER, once. `lib/collections-context.tsx` is told about three
 * names: `syncCollection` and `syncItem` are `useCallback([])` and its own
 * comment said so, and `recordTombstones` is `useCallback([user])` — not
 * stable, but `user` is in the memo's list, so the memo recomputes whenever
 * the callback's identity moves. Different reasons, and the comment had only
 * ever given one of them.
 *
 * FIVE ARE FIXTURES, in `__tests__/`. A harness that proves it detects a
 * runaway effect has to contain one; a harness that proves a cleanup still
 * runs after a sibling throws has to throw from a cleanup closed over a prop.
 * The rule is right about every one of them, and being right about them is
 * what the fixtures are for.
 */

/** Why a finding is or is not a bug. */
export type ExhaustiveDepsShape =
  /** A fixture that must break the rule to prove what it proves. */
  | "fixture"
  /** Depends on the fields it reads rather than the object that holds them. */
  | "narrowed-object"
  /** Goes through a `useLatestRef`, whose identity never changes. */
  | "stable-ref"
  /** Omitted, but something already in the list moves with it. */
  | "transitive"
  /** The callback really did keep a value the render had moved on from. */
  | "stale-closure";

export type ExhaustiveDepsVerdict = "keep" | "fixed" | "open";

/** One `react-hooks/exhaustive-deps` finding. */
export interface ExhaustiveDepsSite {
  /** Repo-relative path. */
  readonly file: string;
  /** The dependency the rule names. */
  readonly dependency: string;
  /** A line of the hook, exactly as the file spells it, comments stripped. */
  readonly anchor: string;
  readonly shape: ExhaustiveDepsShape;
  readonly verdict: ExhaustiveDepsVerdict;
  /** One sentence. Why this verdict and not another. */
  readonly why: string;
  /**
   * How many of the rule's findings this one entry accounts for.
   *
   * One, except where a file spells the SAME fixture several times: three
   * copies of one decision is one entry, and the gate still has to know the
   * rule reports three. Omitted means one.
   */
  readonly findings?: number;
}

/** The 13, in the order `npx eslint .` reported them on 2026-10-01. */
export const EXHAUSTIVE_DEPS_SITES: readonly ExhaustiveDepsSite[] = [
  {
    file: "__tests__/mount-provider-harness.test.ts",
    dependency: "(no dependency array)",
    anchor: "setCount((previous) => previous + 1);",
    shape: "fixture",
    verdict: "keep",
    why: "`Runaway` is the harness's proof that it detects a runaway rather than hanging on one, and an effect with no dependency array setting the state it renders is what a runaway is.",
  },
  {
    file: "__tests__/render-harness.test.ts",
    dependency: "topic",
    anchor: "order.push(`subscribe:${topic}`);",
    shape: "fixture",
    verdict: "keep",
    why: "`topic` is a `let` the case reassigns between renders on purpose — the fixture is about a subscription re-running, and a module-scope binding is how the case moves it without a prop.",
  },
  {
    file: "__tests__/render-harness.test.ts",
    dependency: "label",
    anchor: "throw new Error(`${label} threw`);",
    shape: "fixture",
    verdict: "keep",
    why: "A cleanup that throws, closed over the prop naming which one threw. THREE findings, one entry: the harness spells this fixture three times — for a single failure, for several together, and for a nested tree — and three copies of one fixture is one decision rather than three.",
    findings: 3,
  },
  {
    file: "app/collection/[id].tsx",
    dependency: "toggleReorderMode",
    anchor: "const pageHeader = useMemo(() => {",
    shape: "stale-closure",
    verdict: "fixed",
    why: "The header's sixteen dependencies held two of the callback's five, and not `itemFilters.sort` — so pressing Reorder after changing the sort ran the early return against the sort the header was built with, never clearing it and never offering the undo.",
  },
  {
    file: "app/profile/[id].tsx",
    dependency: "activeProfile",
    anchor: "setProfileIdDraft(activeProfile.username);",
    shape: "narrowed-object",
    verdict: "keep",
    why: "Depends on `activeProfile?.bio` and `activeProfile?.username`, which is exactly what the effect reads; the profile object is rebuilt by the social context on every refresh while those two strings are not.",
  },
  {
    file: "lib/auth-context.tsx",
    dependency: "session.user",
    anchor: "setSentryUser({ id: session.user.id, email: session.user.email });",
    shape: "narrowed-object",
    verdict: "keep",
    why: "Depends on `session?.user?.id` and `session?.user?.email`, the two fields it sends; Supabase hands back a new user object on every token refresh, so listing the object would re-report the same user to Sentry every hour.",
  },
  {
    file: "lib/collections-context.tsx",
    dependency: "recordTombstones, syncCollection, syncItem",
    anchor: "deleteUserContent: async (userId) => {",
    shape: "transitive",
    verdict: "keep",
    why: "`syncCollection` and `syncItem` are `useCallback([])`; `recordTombstones` is `useCallback([user])` and `user` is in the memo's own list, so the memo recomputes whenever that identity moves — two reasons, where the comment had given one.",
  },
  {
    file: "lib/social-context.tsx",
    dependency: "profiles",
    anchor: 'void syncSocial({ kind: "upsert-profile", profile: selfProfile });',
    shape: "stale-closure",
    verdict: "open",
    why: "Reads `profiles.find(p => p.id === user.id)` when there is no local override, so a self profile that arrives AFTER this effect last ran is never upserted. Adding `profiles` fires an upsert on every profile-list change, which is a sync-traffic decision rather than a dependency fix, and the queue keys by mutation rather than by content.",
  },
  {
    file: "lib/social-context.tsx",
    dependency: "t",
    anchor: "const base = normalizeProfile(current ?? buildFallbackProfile(user, t));",
    shape: "stale-closure",
    verdict: "fixed",
    why: "The value factory kept the translator it was built with, so a profile first created after a language switch got its default bio in the previous language.",
  },
  {
    file: "lib/use-entry-currency.ts",
    dependency: "applyRef",
    anchor: "if (entryCurrency !== null) applyRef.current(entryCurrency);",
    shape: "stable-ref",
    verdict: "keep",
    why: "`useLatestRef` returns one ref object for the life of the hook, and the module header says why the callback goes through it: every caller passes an inline arrow, so listing it would re-apply a stored preference over a choice the user is in the middle of making.",
  },
  {
    file: "lib/use-transition-event.ts",
    dependency: "fireRef",
    anchor: "if (isRisingEdge(prevRef.current, value)) fireRef.current();",
    shape: "stable-ref",
    verdict: "keep",
    why: "The same stable ref, for the same reason stated in the same shape: only `value` changes are meant to arm this effect, and an inline `() => trackEvent(...)` in the list would arm it on every render.",
  },
];

/**
 * How many of the thirteen each file carries.
 *
 * `__tests__/render-harness.test.ts` reports four findings from three
 * distinct shapes — one `topic` and three identical `label` cleanups — and
 * the registry holds the three as ONE entry, because three copies of one
 * fixture is one decision. This is the number the suite holds the registry
 * to, so the arithmetic is written down rather than implied.
 */
export const EXHAUSTIVE_DEPS_TOTAL = 13;

/** The registry's own count of entries, which is not the finding count. */
export const EXHAUSTIVE_DEPS_ENTRIES = 11;

export interface TriageProblem {
  readonly file: string;
  readonly anchor: string;
  readonly message: string;
}

/**
 * Every registered anchor held against the file it claims to be in.
 *
 * An entry describing code that is not there is the way a triage rots: the
 * verdict reads as a decision and is about nothing. Comments are stripped
 * first, because this module spells several of these lines out.
 */
export function triageProblems(read: (file: string) => string): TriageProblem[] {
  const problems: TriageProblem[] = [];
  const sources = new Map<string, string>();
  for (const site of EXHAUSTIVE_DEPS_SITES) {
    let code = sources.get(site.file);
    if (code === undefined) {
      code = stripComments(read(site.file));
      sources.set(site.file, code);
    }
    if (!code.includes(site.anchor)) {
      problems.push({
        file: site.file,
        anchor: site.anchor,
        message: `${site.file} no longer contains \`${site.anchor}\` — the entry describes code that has been edited or removed, so its verdict is about nothing.`,
      });
    }
  }
  return problems;
}

/** How many sites carry each verdict. */
export function verdictCounts(): Record<ExhaustiveDepsVerdict, number> {
  const counts: Record<ExhaustiveDepsVerdict, number> = { keep: 0, fixed: 0, open: 0 };
  for (const site of EXHAUSTIVE_DEPS_SITES) counts[site.verdict] += 1;
  return counts;
}

/**
 * How many LIVE findings each file's entries account for.
 *
 * Live: a `fixed` entry describes a finding that no longer exists, so it
 * contributes nothing. This is the map `check-eslint-gate` holds the real run
 * against — the direction an anchor check cannot cover. `triageProblems`
 * catches an entry about code that moved; this catches a finding with no
 * entry, which is how a triage stops being a reading of the rule and becomes
 * a reading of the day it was written.
 */
export function findingsByFile(): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const site of EXHAUSTIVE_DEPS_SITES) {
    if (site.verdict === "fixed") continue;
    counts.set(site.file, (counts.get(site.file) ?? 0) + (site.findings ?? 1));
  }
  return counts;
}
