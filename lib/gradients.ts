import type { LinearGradientProps } from "expo-linear-gradient";

import { HERO_DARK, HERO_DARK_4, HERO_DARK_5 } from "@/lib/design-tokens";

/**
 * Shared `<LinearGradient>` recipes.
 *
 * Each export is a spreadable prop bundle, not a bare colour array, because
 * the angle is part of the recipe: a copy that kept the three colours but
 * lost `start`/`end` renders a visibly different banner while still looking
 * correct in a diff. Spreading the whole bundle makes that class of drift
 * impossible:
 *
 *   <LinearGradient {...HERO_DARK_GRADIENT} style={styles.hero}>
 *
 * `colors` is typed `readonly [ColorValue, ColorValue, ...ColorValue[]]`
 * upstream (at least two stops required), so these are `as const` — a plain
 * `string[]` would not satisfy it.
 */

/** The dark banner behind the home, settings and login heroes. */
export const HERO_DARK_GRADIENT = {
  colors: [HERO_DARK_4, HERO_DARK, HERO_DARK_5],
  start: { x: 0.2, y: 0.6 },
  end: { x: 1, y: 0 },
} as const satisfies Pick<LinearGradientProps, "colors" | "start" | "end">;

/**
 * The scrim laid over a collection's cover photo so white text stays legible
 * on an arbitrary user-uploaded image. Top-to-bottom, hence no `start`/`end`
 * — the default axis is the recipe.
 *
 * Still raw `rgba()` rather than tokens: this is `HERO_DARK_2` at two alpha
 * tiers, and the repo has no `withAlpha()` helper yet (filed
 * repeatedly in `.suggestions.md` as the `OVERLAY_*` family). Centralising
 * the literal here at least means the eventual swap is a one-file edit.
 */
export const PHOTO_SCRIM_GRADIENT = {
  colors: ["rgba(34, 24, 17, 0.08)", "rgba(34, 24, 17, 0.55)"],
} as const satisfies Pick<LinearGradientProps, "colors">;
