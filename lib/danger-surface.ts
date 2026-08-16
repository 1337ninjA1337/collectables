import {
  CARD_BG_8,
  CARD_BG_10,
  DANGER_DEEP_3,
  DANGER_DEEP_4,
  DANGER_SOFT,
  DANGER_SOFT_2,
} from "@/lib/design-tokens";

/**
 * The "reversible destructive action" surface treatment, shared by the two
 * widgets that render it: `<SoftDestructiveChip>` (a 12pt inline pill) and
 * `<DangerSection tone="soft">` (a 15pt block button).
 *
 * Lives in `lib/` rather than beside either component for the same reason
 * `lib/gradients.ts` does — a module under `components/` pulls
 * `@expo/vector-icons` and react-native through the import graph, which cannot
 * be transformed under `tsx --test`, so the values would be pinned by regex
 * over source text instead of by comparing them.
 *
 * Colours only, deliberately: the two consumers are the same treatment at
 * different sizes, so folding padding or radius in here would silently resize
 * one of them. Geometry stays with each component; a test pins the split.
 */
export const SOFT_DESTRUCTIVE_SURFACE = {
  backgroundColor: CARD_BG_10,
  borderWidth: 1,
  borderColor: DANGER_SOFT_2,
} as const;

/** Foreground for anything sitting on {@link SOFT_DESTRUCTIVE_SURFACE}. */
export const SOFT_DESTRUCTIVE_FOREGROUND = DANGER_DEEP_4;

/**
 * The per-row "delete this one" surface: the icon-only trash button that sits
 * at the end of a list row, worn by `<DangerIconButton>`.
 *
 * It is a WARMER sibling of {@link SOFT_DESTRUCTIVE_SURFACE} — `CARD_BG_8`
 * over `CARD_BG_10`, `DANGER_SOFT` over `DANGER_SOFT_2`, `DANGER_DEEP_3` over
 * `DANGER_DEEP_4`, each pair a channel or two apart and none of it visible to
 * the eye — and the honest reason both exist is arrival order: the
 * wishlist row shipped its recipe before `lib/danger-surface.ts` existed, and
 * it is exactly the "one channel off" drift `<SoftDestructiveChip>`'s doc
 * comment warns about, caught a shade further along.
 *
 * Lifting it VERBATIM is deliberate. Repointing the row at the soft trio would
 * repaint shipped UI, which is a design decision and not a refactor — so the
 * two surfaces get one home each and a name apiece, and unifying them is filed
 * as a suggestion rather than smuggled in under an extraction. What this does
 * buy today: the next list view that wants a per-row delete reaches for the
 * widget instead of re-deriving a third triple.
 *
 * Colours only, for the same reason as the soft surface: geometry stays with
 * the component, and a test pins the split.
 */
export const DESTRUCTIVE_ICON_SURFACE = {
  backgroundColor: CARD_BG_8,
  borderWidth: 1,
  borderColor: DANGER_SOFT,
} as const;

/** Foreground for anything sitting on {@link DESTRUCTIVE_ICON_SURFACE}. */
export const DESTRUCTIVE_ICON_FOREGROUND = DANGER_DEEP_3;
