/**
 * Single-namespace aggregator over the design system: `tokens` carries the
 * whole palette AND the geometry tokens (RADIUS_*, SPACING_*) as one frozen
 * object, so style-heavy files can write
 *
 *   import { tokens } from "@/lib/styles";
 *   card: { backgroundColor: tokens.CARD_BG, borderRadius: tokens.RADIUS_CARD }
 *
 * instead of a ~10-line named-import block from `@/lib/design-tokens`.
 *
 * Adoption is opt-in per file: named imports stay the convention for files
 * that only need a couple of values (and the per-file adoption tests +
 * lint:radius/lint:hex guards work identically against either form —
 * `tokens.RADIUS_CARD` is still not a literal). New screens with big
 * StyleSheets are the intended consumers.
 *
 * This module deliberately adds nothing of its own — it re-exports the
 * canonical `designTokens` object (and its types) so there is exactly one
 * source of truth and the two import paths can never drift.
 */
export {
  designTokens as tokens,
  type ColorTokenName,
  type ColorTokenValue,
  type ColorValue,
  type BackgroundColorValue,
  type DesignToken,
} from "@/lib/design-tokens";
