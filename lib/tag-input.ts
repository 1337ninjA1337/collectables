import { TAG_COLORS, nextTagColor } from "@/lib/design-tokens";
import type { ItemTag } from "@/lib/types";

/**
 * Adding a tag to an item, decided once for both forms that do it.
 *
 * `app/create.tsx` and `app/item/[id].tsx` each had a hand-written `addTag()`
 * with the same three rules and different state-variable names, which is the
 * shape that drifts: the new-item form and the item-edit form could disagree
 * about what counts as a duplicate, or hand the same label two different
 * colours, and nothing would notice.
 *
 * Pure, so the rules can be asserted rather than read: both screens pull React
 * Native and neither can be imported under `tsx --test`.
 */

/**
 * What happened when the user pressed Add.
 *
 * `"empty"` and `"duplicate"` were both a bare `return` before, so pressing
 * Add on a label already in the list looked exactly like a broken button.
 * They are separated here because only one of them is worth saying out loud:
 * an empty input explains itself, and a duplicate does not.
 */
export type AddTagResult =
  | { readonly status: "added"; readonly tags: ItemTag[] }
  | { readonly status: "empty" }
  | { readonly status: "duplicate"; readonly existing: ItemTag };

/**
 * A stable index into `TAG_COLORS` for a label.
 *
 * The same string always lands on the same slot — the `placeholder-color.ts`
 * idiom, which the repo already uses to give a collection a stable avatar
 * colour. Case-folded, because "Sealed" and "sealed" are the same tag to the
 * duplicate check below and should not be two colours.
 */
function labelSlot(label: string): number {
  const normalized = label.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % TAG_COLORS.length;
}

/**
 * The colour a tag should get: its label's own hue, unless that hue is taken.
 *
 * The rotation alone (`nextTagColor`) only ever looks at the tags on the item
 * in front of it, so "sealed" was amber on one card and sage on the next —
 * which defeats the point of colour-coding a label that means the same thing
 * everywhere. Deriving from the label fixes that, and would reintroduce the
 * problem the rotation was written for if it stopped there: two different
 * labels can hash to one slot, and two same-coloured tags side by side on one
 * item is exactly what the user reads as a mistake.
 *
 * So the label's hue is a PREFERENCE. When it is already on the item, the
 * rotation picks the first free slot instead, and the consistency is traded
 * away only in the case where keeping it would be visibly wrong.
 */
export function tagColorForLabel(label: string, usedColors: readonly string[]): string {
  const preferred = TAG_COLORS[labelSlot(label)];
  if (!usedColors.includes(preferred)) return preferred;
  return nextTagColor(usedColors);
}

/**
 * The tag list after the user submits `rawLabel`, or why it is unchanged.
 *
 * Trimmed, because a trailing space is not a different tag. Compared
 * case-insensitively for the same reason, and the EXISTING casing wins: the
 * user typed that one first, and rewriting it under them on a second submit
 * would be a silent edit of data they can see.
 */
export function addTagToList(tags: readonly ItemTag[], rawLabel: string): AddTagResult {
  const label = rawLabel.trim();
  if (!label) return { status: "empty" };
  const existing = tags.find((tag) => tag.label.toLowerCase() === label.toLowerCase());
  if (existing) return { status: "duplicate", existing };
  const color = tagColorForLabel(label, tags.map((tag) => tag.color));
  return { status: "added", tags: [...tags, { label, color }] };
}

/**
 * Every tag's colour re-derived from its own label, collisions resolved left
 * to right.
 *
 * `tagColorForLabel` keeps the visible set distinct at ADD time and never
 * looks at it again, so the set decays as soon as anything is removed. Put
 * five tags on an item where the 2nd and 4th hash to the same slot: the 4th
 * takes a rotation colour, the 2nd is deleted, and its hue is now free while
 * the 4th keeps the borrowed one for good. The label-consistency this was all
 * written for — "sealed" is the same colour everywhere — is gone for that tag,
 * on every card it appears on, and nothing will ever put it back.
 *
 * So the rule is re-applied to the whole list rather than to one new entry.
 * Left to right, because the order is the one the user sees and an earlier tag
 * changing colour when a later one is deleted would be the more surprising of
 * the two: the tag they did not touch is the tag that should not move.
 *
 * The list is returned BY IDENTITY when no colour changed, and each unchanged
 * tag keeps its own object. A pass that rebuilt everything would make this
 * safe to call anywhere and expensive to call from a render, and the callers
 * write it straight back into state.
 */
export function rebalanceTagColors(tags: readonly ItemTag[]): ItemTag[] {
  const used: string[] = [];
  let changed = false;
  const rebalanced = tags.map((tag) => {
    const color = tagColorForLabel(tag.label, used);
    used.push(color);
    if (color === tag.color) return tag;
    changed = true;
    return { ...tag, color };
  });
  return changed ? rebalanced : (tags as ItemTag[]);
}

/**
 * The tag list with the entry at `index` removed, and the rest rebalanced.
 *
 * Both forms wrote `tags.filter((_, j) => j !== i)` inline — the same shape
 * `addTagToList` was extracted to end, one operation down. Removal is where
 * the colours go stale, so the rebalance rides here rather than being a second
 * call each screen has to remember: a delete that left the hues alone is
 * exactly the bug above, and it would be invisible on the screen that did it.
 *
 * An index nothing is at returns the list unchanged, by identity. A stale
 * press on a row that has already gone is a real sequence on a slow render,
 * and rebuilding the list for it would be a state write with nothing in it.
 */
export function removeTagAt(tags: readonly ItemTag[], index: number): ItemTag[] {
  if (index < 0 || index >= tags.length) return tags as ItemTag[];
  return rebalanceTagColors(tags.filter((_, at) => at !== index));
}

/**
 * A tag list from OUTSIDE this app's forms, put under the same three rules.
 *
 * `addTagToList` and `removeTagAt` keep a list correct while a user is editing
 * it, and they are not the only way a list arrives. A row pulled from Supabase
 * was written by another device — possibly an older build, possibly one that
 * predates the label hash entirely — and a blob read back from AsyncStorage
 * was written by whatever this app was months ago. Neither has ever been
 * checked against the rules the forms enforce, so a peer's edit can hand this
 * app two "sealed" tags in different casings, an empty label, or a set of hues
 * derived by the old rotation and meaningless anywhere else.
 *
 * Three rules, and they are the form's rules rather than new ones:
 *
 *  - **An empty label is not a tag.** A chip with nothing in it is unreadable
 *    and unremovable in the same gesture as any other.
 *  - **The FIRST of a case-folded duplicate wins**, matching the add rule: the
 *    casing that arrived first is the one the user typed, and rewriting it is
 *    a silent edit of data they can see.
 *  - **Colours are re-derived**, so a label means the same hue here as it does
 *    on an item created today.
 *
 * Idempotent, which is what makes it safe on a read path: the cloud merge
 * compares a normalized row against a normalized local one, so a list that has
 * already been through this reads as unchanged and nothing is rewritten. It
 * also returns the list BY IDENTITY when it had nothing to say, for the same
 * reason — a fresh array on every pull is a re-render and two storage writes.
 */
export function normalizeTagList(tags: readonly ItemTag[]): ItemTag[] {
  const seen = new Set<string>();
  const kept: ItemTag[] = [];
  let dropped = false;
  for (const tag of tags) {
    const label = tag.label.trim();
    const folded = label.toLowerCase();
    if (!folded || seen.has(folded)) {
      dropped = true;
      continue;
    }
    seen.add(folded);
    // The trim is part of the rule, so a label that only differed by
    // surrounding space is rewritten rather than kept as its own tag.
    kept.push(label === tag.label ? tag : { ...tag, label });
  }
  const rebalanced = rebalanceTagColors(kept);
  if (dropped) return rebalanced;
  // `kept` is a fresh array either way; the caller's list is only unchanged
  // when nothing was dropped AND every tag came through untouched.
  return rebalanced.every((tag, at) => tag === tags[at]) ? (tags as ItemTag[]) : rebalanced;
}

/**
 * {@link normalizeTagList} over a list of items, for the hydrate.
 *
 * The item list is where the rule has to be applied on the way IN, not the tag
 * list: nothing else in this app holds a bare `ItemTag[]` long enough to
 * normalise it, and the hydrate already runs three passes of exactly this
 * shape (`normalizeOwnItemIds`, `dedupeItems`, `applyTombstones`), each of
 * them pure and each returning its input by identity when it found nothing.
 * This is the fourth, and it is written the same way for the same reason: the
 * hydrate's result goes straight into state and then into both storage blobs,
 * so an allocation with no change in it costs a render and two writes.
 */
export function normalizeItemTags<T extends { tags?: ItemTag[] }>(items: readonly T[]): T[] {
  let changed = false;
  const normalized = items.map((item) => {
    if (!item.tags) return item;
    const tags = normalizeTagList(item.tags);
    if (tags === item.tags) return item;
    changed = true;
    return { ...item, tags };
  });
  return changed ? normalized : (items as T[]);
}
