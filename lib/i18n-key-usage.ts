import { stripComments } from "@/lib/strip-comments";

/**
 * WHICH translation keys each source file reads — the reverse index behind
 * `check-orphan-i18n-keys`, extracted so it can answer more than one question.
 *
 * The orphan guard asks "is this key read ANYWHERE", and that is a projection
 * of a bigger fact the same walk already computes: for every file, the set of
 * base keys it names. Answering the smaller question threw the bigger one away
 * — the walk collected literals into one flat `mentioned` set and the file each
 * came from was gone by the time the answer was formed.
 *
 * The bigger fact is what a per-SCREEN i18n rule needs. Six runs of translation
 * work sliced the map by key PREFIX (`filter*`, `marketplace*`, `collection*`)
 * until the prefixes ran out: 175 keys remain English in the four partial
 * locales and the largest remaining prefix group is seven. The unit that groups
 * the remainder the way a user meets it is the screen — every key
 * `app/friends.tsx` renders — and "this screen is half-translated" is only a
 * checkable claim once something can say which keys a screen renders. That is
 * this module, and it is deliberately the enabling half: it indexes, it does
 * not judge. No rule about coverage lives here.
 *
 * WHAT COUNTS AS A READ, and why it is not `t("…")`.
 *
 * The obvious rule — match `t("key")` — is wrong here, and measurably: 43 of
 * this tree's 502 base keys are never written inside a `t(...)` call at all.
 * They are reached through four different forms:
 *
 *  - `t("filterClearSearch")`, the direct call;
 *  - `{ mode: "name-asc", labelKey: "sortNameAsc" }` in `lib/item-filters.ts`
 *    and `from_negative: "filterPriceNegative"` beside it — a key stored in a
 *    table and handed to `t()` somewhere else entirely;
 *  - `pick(t, "crashFallbackTitle")` in `components/crash-fallback.tsx`, a
 *    helper that takes the key and the translator;
 *  - ``t(`condition${…}` as "conditionNew" | "conditionExcellent" | …)``, the
 *    tree's only dynamic key build, which spells its union out in an `as`
 *    clause.
 *
 * So the rule is: a base key is READ by a file if it appears in that file as a
 * bare string literal. That covers all four forms uniformly, and it is what
 * makes an exemptions list unnecessary — the `as` clause of the dynamic build
 * IS a list of string literals, so the case the original design worried about
 * (a hand-maintained allowlist for dynamic keys, drifting out of date) does not
 * arise. If a fifth form ever appears that this cannot see, the fix is to widen
 * the rule or to write the key down in an `as` clause, not to exempt it: an
 * exemption is a key nobody has to justify again.
 *
 * WHERE the literal sits matters too, and that is the second thing this rule
 * learned. Shipped first as "appears as a string literal ANYWHERE", which had
 * a blind spot: a key whose name collides with an unrelated literal counts as
 * read. Measuring the blind spot against the tree — the follow-up the first
 * version filed against itself — found it had exactly one occupant, and it was
 * a real orphan. `you` ("You", and translated into all six locales) was
 * rendered by nothing; its only mention in the tree was
 * `user.email?.split("@")[0] ?? "you"` in `lib/social-context.tsx`, a default
 * display name that has nothing to do with the key.
 *
 * So a mention only counts when the literal sits in a POSITION a translation
 * key is written in: after `(` or `,` (an argument — `t("k")`,
 * `pick(t, "k")`), after `:` (a record value — `from_negative: "k"`,
 * `labelKey: "k"`), after `as` or `|` (a union member, including the
 * continuation lines of a multi-line one). A fallback value — `?? "you"` — is
 * preceded by `?` and qualifies under none of them. Measured over the whole
 * tree, this reports one orphan and no false positives; the looser rule
 * reported none and missed it.
 *
 * The rule is still LOOSE in one direction, and that is the price of having no
 * exemptions: a key colliding with an unrelated literal that HAPPENS to sit in
 * one of those positions would still count as read. It is much tighter than
 * the bare-word matching the throwaway scans used, which counted `profileId`
 * as read because `lib/social-context.tsx` declares six `(profileId: string)`
 * PARAMETERS. Prefer a rule that reports one real orphan late over one that
 * reports a live key.
 *
 * That looseness has a second consequence now that the index is per FILE, and
 * it points the other way: a file whose literal collides with a key is credited
 * with reading a string it does not render. Harmless for the orphan question
 * (one false "read" among 264 files changes nothing unless it is the only one),
 * and worth stating for a per-screen consumer, where a single file's list IS
 * the answer rather than one vote in it.
 *
 * Comments are stripped before matching, so a doc block naming a key does not
 * count as reading it — this module's own would otherwise credit itself with
 * nine. `lib/i18n-context.tsx` is excluded from the walk by the CLI for the
 * same reason at a larger scale: it declares every key, so including it would
 * make every key read and the orphan guard vacuous.
 *
 * Pure module: no filesystem access — callers walk the tree and hand sources
 * over, so the index is unit-testable under `node --test`.
 */

/** One source file, as a caller hands it over. */
export type ScannedSource = {
  readonly file: string;
  readonly source: string;
};

/**
 * A string literal sitting where a translation key is written.
 *
 * The alternation is the rule, so it is worth reading slowly. What may precede
 * the literal:
 *  - `(` — the first argument of a call: `t("k")`;
 *  - `,` — a later argument, or an array element: `pick(t, "k")`, `["a", "k"]`;
 *  - `:` — a record value: `from_negative: "k"`, `labelKey: "k"`;
 *  - `as` — a type assertion: ``t(`condition${c}` as "conditionNew" | …)``;
 *  - `|` — a union member, which is how the continuation lines of a
 *    multi-line assertion are spelled.
 *
 * What is deliberately NOT here is every other expression position — `??`,
 * `=`, `===`, `+`, `return`. A literal in one of those is a VALUE, and the one
 * that made the distinction worth drawing is `?? "you"`.
 *
 * Contents restricted to identifier shapes because that is what a translation
 * key is: matching arbitrary string bodies would pull in every sentence in the
 * tree for hits that can never be keys.
 */
const KEY_POSITION_LITERAL = /(?:[(,:|[]|\bas)\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;

/**
 * Every identifier-shaped string literal in one source that sits in a key
 * position, comments stripped.
 *
 * The raw rule, unfiltered by any key map: callers that hold a list of keys
 * want {@link indexI18nKeyUsage}, and callers asking "does this file name this
 * word at all" — `dead-i18n-keys.test.ts`, about keys that no longer exist in
 * any map — want this.
 */
export function collectStringLiterals(source: string): ReadonlySet<string> {
  const literals = new Set<string>();
  for (const match of stripComments(source).matchAll(KEY_POSITION_LITERAL)) {
    literals.add(match[1]);
  }
  return literals;
}

/**
 * Which files read which keys, indexed both ways.
 *
 * Both maps are COMPLETE over what was asked: every scanned file has an entry
 * in {@link byFile} and every key handed in has one in {@link byKey}, empty
 * where there is nothing to report. That costs a few hundred empty arrays and
 * buys the distinction a sparse map loses — "this screen renders no translated
 * text" and "this screen was not scanned" are different answers, and a
 * per-screen rule that could not tell them apart would read an unscanned
 * directory as a screen with nothing to translate.
 */
export type I18nKeyUsage = {
  /** File → the base keys it reads, in base-map order. */
  readonly byFile: ReadonlyMap<string, readonly string[]>;
  /** Base key → the files that read it, in the order they were scanned. */
  readonly byKey: ReadonlyMap<string, readonly string[]>;
};

/**
 * Indexes `sources` against `baseKeys`.
 *
 * Per-file lists come back in BASE-MAP order rather than in the order the
 * literals appear in the file, which is the same choice the orphan report
 * makes and for the same reason: keys that belong to one feature are adjacent
 * in the map, so a family reads as a run rather than as a scatter. Source
 * order would be the order a screen happens to render in, which no reader is
 * comparing anything against.
 *
 * Per-key lists keep SCAN order, because that is the caller's own order — the
 * walk sorts its files, so the list reads alphabetically without this module
 * claiming to have sorted anything.
 *
 * Keys outside `baseKeys` are dropped: this answers "which of THESE keys does
 * the file read", so a literal that is not a key is not a finding here. A
 * caller wanting the unfiltered set has {@link collectStringLiterals}.
 */
export function indexI18nKeyUsage(
  baseKeys: readonly string[],
  sources: readonly ScannedSource[],
): I18nKeyUsage {
  const byFile = new Map<string, readonly string[]>();
  const byKey = new Map<string, string[]>();
  for (const key of baseKeys) byKey.set(key, []);

  for (const { file, source } of sources) {
    const literals = collectStringLiterals(source);
    const read: string[] = [];
    // Iterating the KEYS rather than the file's literals is what puts the
    // result in base-map order, and it is also the drop rule: a literal that
    // is not a key is never asked about, so it reaches neither map.
    for (const key of baseKeys) {
      if (!literals.has(key)) continue;
      read.push(key);
      byKey.get(key)?.push(file);
    }
    byFile.set(file, read);
  }

  return { byFile, byKey };
}

/**
 * The keys nothing read, in base-map order.
 *
 * The orphan question, as a projection of the index rather than as a second
 * walk. Base-map order for the reason above: a dead FAMILY reports as a run of
 * adjacent keys, which is how a reader recognises "this is one feature" rather
 * than "these are nine unrelated mistakes".
 */
export function unreadI18nKeys(usage: I18nKeyUsage): readonly string[] {
  const unread: string[] = [];
  for (const [key, files] of usage.byKey) {
    if (files.length === 0) unread.push(key);
  }
  return unread;
}
