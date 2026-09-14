/**
 * "Does this element carry this prop?", asked of the element rather than of
 * the file.
 *
 * THE SHAPE THIS REPLACES, written thirty-one times across eighteen suites:
 *
 *     assert.match(src, /<FlatList[\s\S]*?windowSize=\{\s*5\s*\}[\s\S]*?\/>/);
 *
 * which reads as "the FlatList sets windowSize to 5" and MEANS "somewhere
 * after some `<FlatList` there is this text before some `/>`". Three things
 * are wrong with it and only the third is obvious:
 *
 *  1. `app/collection/[id].tsx` renders three FlatLists (viewer, selection,
 *     drag-mode fallback). The wildcard runs from the FIRST one, so a prop on
 *     the third satisfies an assertion whose name says the first.
 *  2. The wildcard crosses element boundaries. The viewer FlatList nests a
 *     `<RefreshControl … />`, so `[\s\S]*?\/>` stops at the RefreshControl's
 *     close and the "FlatList's props" being tested are partly another
 *     element's.
 *  3. It is the hand-rolled open-tag walk `lint:jsx-walk` refuses, reached
 *     through a bit of anchoring text rather than directly.
 *
 * `openTagsNamed` answers the same question properly: the tags of that
 * element, each whole, each ending at its own `>` with brace depth counted —
 * so a prop found in one is a prop that element has.
 *
 * EVERY ASSERTION HERE FLOORS ITSELF. A file with no `<FlatList>` at all makes
 * `some(…)` false and `every(…)` true, so the negative form would pass over a
 * tree it never read — the same vacuity three window assertions were fixed for
 * on 2026-09-14. Both functions refuse an empty tag list first, by name.
 */

import assert from "node:assert/strict";

import { elementSpan, openTagsNamed, tagsNamed } from "@/lib/jsx-open-tag";
import { stripComments } from "@/lib/strip-comments";

/**
 * The opening tags of one element, refused if the source renders none.
 *
 * Comments are blanked first, for two reasons a caller should not have to
 * remember. A screen that NAMES `<CollectionShareSheet>` in its prose has a
 * tag there as far as a text walk is concerned, and it has no props — so the
 * first assertion about the call site fails against a doc comment. And an
 * apostrophe in a line comment INSIDE an open tag used to make the walk yield
 * nothing at all for the whole file (fixed in `skipStringLiteral`, found from
 * exactly this call path); blanking is still the honest input.
 */
export function elementTags(source: string, name: string, where = "this source"): string[] {
  const tags = openTagsNamed(stripComments(source), name);
  assert.ok(
    tags.length > 0,
    `${where} renders no <${name}> — every assertion about its props would be vacuous`,
  );
  return tags;
}

/**
 * Some `<name …>` in `source` carries `prop`.
 *
 * "Some" rather than "the", because the files this is used on render two and
 * three of the same element and the assertions are about whichever one has the
 * prop. It is still far tighter than the wildcard it replaces: the prop has to
 * be inside ONE element's opening tag rather than anywhere between a `<name`
 * and the next `>`.
 */
export function assertSomeElementHas(
  source: string,
  name: string,
  prop: RegExp,
  message?: string,
): void {
  const tags = elementTags(source, name, message ?? "the source");
  assert.ok(
    tags.some((tag) => prop.test(tag)),
    message ?? `no <${name}> in this source carries ${prop}`,
  );
}

/**
 * The one `<name …>` carrying `marker`, refused unless there is exactly one.
 *
 * Five suites ask for "the viewer FlatList" in `app/collection/[id].tsx`,
 * which renders three of them and is told apart by
 * `numColumns={masonryColumnCount}`. Each one used to write
 * `src.match(/<FlatList[\s\S]*?numColumns=\{\s*masonryColumnCount\s*\}[\s\S]*?\/>/)`,
 * which starts at the FIRST FlatList in the file and runs past whatever lies
 * between — so the "block" being asserted about spanned two other lists.
 *
 * Exactly one, not the first: two matching elements means the marker has
 * stopped identifying anything, and picking one of them would keep the suite
 * green while it tested a list nobody meant.
 */
export function elementTagWith(
  source: string,
  name: string,
  marker: RegExp,
  what: string,
): string {
  const matching = elementTags(source, name, what).filter((tag) => marker.test(tag));
  assert.equal(
    matching.length,
    1,
    `${what}: expected exactly one <${name}> carrying ${marker}, found ${matching.length}`,
  );
  return matching[0];
}

/** One element, whole: its opening tag, its body, and the two together. */
export type FoundElement = {
  /** The opening tag, `<` through `>` — where the props are. */
  readonly tag: string;
  /** Everything between that `>` and the matching close — `""` if none. */
  readonly body: string;
  /** Both, which is what a "does this element mention X" assertion reads. */
  readonly text: string;
};

/**
 * The one `<name …>…</name>` carrying `marker`, body included.
 *
 * {@link elementTagWith}'s question when the assertion is about what the
 * element CONTAINS rather than what props it takes — the visibility chip's
 * whole JSX, the sort chip's label, the admin button passed as children.
 *
 * Nine suites asked it as `/<Pressable[\s\S]*?key=\{v\}[\s\S]*?<\/Pressable>/`,
 * which ends at the first `</Pressable>` after the marker and so hands a
 * parent's body to its first child — the depth bug `closeTagIndex` was written
 * for, and one of these really does wrap a nested Pressable.
 *
 * Same "exactly one" refusal as {@link elementTagWith}, for the same reason.
 */
export function elementWith(
  source: string,
  name: string,
  marker: RegExp,
  what: string,
): FoundElement {
  const code = stripComments(source);
  const tags = tagsNamed(code, name);
  assert.ok(tags.length > 0, `${what}: this source renders no <${name}>`);
  const matching = tags.filter((tag) => marker.test(code.slice(tag.start, tag.tagEnd + 1)));
  assert.equal(
    matching.length,
    1,
    `${what}: expected exactly one <${name}> carrying ${marker}, found ${matching.length}`,
  );
  const span = elementSpan(code, matching[0]);
  assert.ok(span, `${what}: its <${name}> never closes`);
  return {
    tag: code.slice(matching[0].start, matching[0].tagEnd + 1),
    body: span.body,
    text: code.slice(span.start, span.end),
  };
}

/** No `<name …>` in `source` carries `prop`, over a list proved non-empty. */
export function assertNoElementHas(
  source: string,
  name: string,
  prop: RegExp,
  message?: string,
): void {
  const tags = elementTags(source, name, message ?? "the source");
  const offenders = tags.filter((tag) => prop.test(tag));
  assert.deepEqual(
    offenders.map((tag) => tag.split("\n")[0].trim().slice(0, 90)),
    [],
    message ?? `a <${name}> carries ${prop}, which it must not`,
  );
}
