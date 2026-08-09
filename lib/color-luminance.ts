/**
 * Rec. 601 luma helpers for the design-token palette.
 *
 * Three copies of the same six-line YIQ approximation had accumulated — one in
 * `app/_dev/tokens.tsx` (picking a readable swatch label), one in
 * `__tests__/toast-design-tokens.test.ts` and one in
 * `__tests__/design-tokens-cool-family.test.ts` (both ordering a family). They
 * agreed by luck, not by construction; this module is the single definition so
 * a future family test cannot quietly use a different weighting and reach a
 * different conclusion about which of two shades is "darker".
 *
 * Rec. 601 luma, not WCAG relative luminance: it is a cheap channel-weighted
 * average on the raw sRGB bytes with no gamma expansion, so it does NOT predict
 * contrast ratios and must not be used for accessibility checks. What it is
 * good at is ORDERING shades that already share a hue, which is the whole job
 * here — every question the palette asks ("is `_SOFT` lighter than `_DEEP`?")
 * is a comparison inside one warm family, and the gamma step cancels out of a
 * comparison. Reach for a real WCAG contrast helper if a contrast requirement
 * ever needs pinning; do not extend this one into that role.
 *
 * Pure and dependency-free so it imports under `tsx --test` as well as into the
 * Expo bundle.
 */

/** Rec. 601 luma of pure white — the top of the {@link luminance} range. */
export const LUMA_MAX = 255;

/**
 * Above this luma a swatch needs dark text on it. Tuned for the dev token
 * preview route, which is where the threshold originally lived.
 */
export const LIGHT_LABEL_THRESHOLD = 160;

export type Rgb = [red: number, green: number, blue: number];

/** A named colour, the shape every ordering helper below consumes. */
export type ColorEntry = { name: string; value: string };

/** A {@link ColorEntry} with its computed luma, as returned by {@link rankByLuminance}. */
export type RankedColor = ColorEntry & { luma: number };

/**
 * Split `#rgb` / `#rrggbb` (with or without the `#`, any case) into channels.
 *
 * Returns `null` rather than throwing or coercing: callers here are a dev-only
 * preview route and a set of palette tests, and both have a sensible answer for
 * "this is not a colour" that is not a crash.
 */
export function rgbChannels(hex: string): Rgb | null {
  const cleaned = (hex.startsWith("#") ? hex.slice(1) : hex).toLowerCase();
  if (!/^[0-9a-f]+$/.test(cleaned)) return null;

  // Expand the 3-digit shorthand so a shorthand white and a long-form white
  // rank identically — the palette carries a handful of shorthands, and they
  // name the same colours the long forms do.
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (full.length !== 6) return null;

  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Rec. 601 luma on a 0–255 scale. `NaN` for anything that is not a hex colour,
 * which propagates falsy through every comparison below instead of silently
 * ranking as black.
 */
export function luminance(hex: string): number {
  const channels = rgbChannels(hex);
  if (!channels) return Number.NaN;
  const [r, g, b] = channels;
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * Whether a swatch is light enough to need dark text on it. Non-colours count
 * as light, so an unrecognised value gets the dark label that is readable
 * against the page background rather than white-on-white.
 */
export function isLightHex(hex: string, threshold: number = LIGHT_LABEL_THRESHOLD): boolean {
  const luma = luminance(hex);
  return Number.isNaN(luma) ? true : luma > threshold;
}

/** True when red is the dominant channel — what makes a warm/red family warm. */
export function isRedDominant(hex: string): boolean {
  const channels = rgbChannels(hex);
  if (!channels) return false;
  const [r, g, b] = channels;
  return r > g && r > b;
}

/** Entries sorted lightest → darkest. Non-colours sort last. Does not mutate. */
export function rankByLuminance(entries: readonly ColorEntry[]): RankedColor[] {
  return entries
    .map((entry) => ({ ...entry, luma: luminance(entry.value) }))
    .sort((a, b) => {
      if (Number.isNaN(a.luma)) return Number.isNaN(b.luma) ? 0 : 1;
      if (Number.isNaN(b.luma)) return -1;
      return b.luma - a.luma;
    });
}

/** The lightest and darkest luma in a family, or `null` for an empty list. */
export function luminanceBand(
  entries: readonly ColorEntry[],
): { lightest: RankedColor; darkest: RankedColor } | null {
  const ranked = rankByLuminance(entries).filter((entry) => !Number.isNaN(entry.luma));
  if (ranked.length === 0) return null;
  return { lightest: ranked[0], darkest: ranked[ranked.length - 1] };
}

/**
 * First adjacent pair that breaks a light → dark reading of `entries` in the
 * order given, or `null` when the list darkens monotonically.
 *
 * This is the "did someone append a `DANGER_DEEP_9` that is pale pink" check,
 * expressed so it extends to any family whose suffixes claim an ordering. It
 * reports the offending PAIR rather than a boolean because the failure message
 * is the whole value: "these two are in the wrong order" is actionable, "the
 * family is not monotonic" sends you to count nine hex values by hand.
 *
 * Equal luma counts as a break: two tokens the eye cannot tell apart are a
 * naming problem even when the ordering is technically not violated.
 */
export function findLuminanceBreak(
  entries: readonly ColorEntry[],
): { lighter: RankedColor; darker: RankedColor } | null {
  const withLuma = entries.map((entry) => ({ ...entry, luma: luminance(entry.value) }));
  for (let i = 1; i < withLuma.length; i += 1) {
    const lighter = withLuma[i - 1];
    const darker = withLuma[i];
    if (Number.isNaN(lighter.luma) || Number.isNaN(darker.luma)) return { lighter, darker };
    if (lighter.luma <= darker.luma) return { lighter, darker };
  }
  return null;
}

/**
 * Every pair where a member of `lighterFamily` is not at least `minGap` luma
 * above a member of `darkerFamily`.
 *
 * Families whose numbered suffixes are assigned by arrival order (`DANGER_*`,
 * `MUTED_*`, `CARD_BG_*`) are not internally monotonic and never will be — the
 * suffix is an ID, not a rank. What still holds, and what actually catches a
 * bad insert, is that the BANDS do not overlap: no `_SOFT` may be darker than
 * any `_DEEP`. `minGap` keeps the check from passing on a one-unit sliver.
 */
export function findBandOverlaps(
  lighterFamily: readonly ColorEntry[],
  darkerFamily: readonly ColorEntry[],
  minGap = 0,
): { lighter: RankedColor; darker: RankedColor; gap: number }[] {
  const overlaps: { lighter: RankedColor; darker: RankedColor; gap: number }[] = [];
  for (const lighter of rankByLuminance(lighterFamily)) {
    for (const darker of rankByLuminance(darkerFamily)) {
      const gap = lighter.luma - darker.luma;
      if (!(gap >= minGap)) overlaps.push({ lighter, darker, gap });
    }
  }
  return overlaps;
}
