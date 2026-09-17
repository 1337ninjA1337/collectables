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
