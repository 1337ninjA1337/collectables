import { CARD_BG_10, DANGER_DEEP_4, DANGER_SOFT_2 } from "@/lib/design-tokens";

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
