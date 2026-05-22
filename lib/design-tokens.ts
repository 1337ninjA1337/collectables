/**
 * Brand color palette. Use these constants instead of hard-coded hex literals
 * so a palette-wide change is a one-line edit and TypeScript catches typos.
 *
 * Naming convention:
 *   `HERO_*`   — high-contrast surfaces (dark hero cards, primary buttons)
 *   `AMBER_*`  — warm accent used for CTAs and highlight chips
 *   `CARD_*`   — neutral cream surfaces used for content cards
 *   `BORDER_*` — subtle hairline borders
 *   `TEXT_*`   — foreground colors (dark on cream, cream on dark)
 *   `MUTED_*`  — secondary / placeholder text
 *   `DANGER_*` — destructive / error states
 */

export const HERO_DARK = "#261b14";
export const HERO_DARK_2 = "#2a1d15";
export const HERO_DARK_3 = "#3a2716";
export const HERO_DARK_4 = "#3d2810";
export const HERO_DARK_5 = "#1e140e";
export const HERO_DARK_6 = "#2c2017";

export const AMBER_ACCENT = "#d89c5b";
export const AMBER_LIGHT = "#f5c99a";
export const AMBER_SOFT = "#e4c29a";
export const AMBER_MUTED = "#d9c2a8";

export const CARD_BG = "#fffaf3";
export const CARD_BG_2 = "#fff7ef";
export const CARD_BG_3 = "#fff1df";
export const PAGE_BG = "#fff8ef";

export const BORDER = "#eadbc8";
export const BORDER_2 = "#f0e2cf";
export const BORDER_3 = "#f0e4d0";

export const TEXT_DARK = "#2f2318";
export const TEXT_DARK_2 = "#241912";
export const TEXT_DARK_3 = "#2d2117";
export const TEXT_ON_DARK = "#fff7ef";
export const TEXT_ON_DARK_2 = "#fff5ea";
export const TEXT_ON_DARK_3 = "#fff8ef";
export const TEXT_ON_DARK_4 = "#fff4e8";
export const TEXT_ON_DARK_SOFT = "#ead8c3";
export const TEXT_ON_DARK_MUTED = "#dfc8b2";

export const MUTED = "#8f6947";
export const MUTED_2 = "#6b5647";
export const MUTED_3 = "#5f4734";
export const MUTED_4 = "#bbb0a6";
export const MUTED_5 = "#715d4d";
export const MUTED_6 = "#6f5c4d";
export const MUTED_7 = "#856d5a";
export const MUTED_8 = "#6b5543";
export const PLACEHOLDER = "#9b8571";

export const PURE_WHITE = "#ffffff";

export const DANGER = "#d92f2f";
export const DANGER_DEEP = "#a13434";
export const SUCCESS_GREEN = "#3a7d4f";

/** Frozen palette for runtime introspection (e.g. tests, theming UI). */
export const designTokens = Object.freeze({
  HERO_DARK,
  HERO_DARK_2,
  HERO_DARK_3,
  HERO_DARK_4,
  HERO_DARK_5,
  HERO_DARK_6,
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_SOFT,
  AMBER_MUTED,
  CARD_BG,
  CARD_BG_2,
  CARD_BG_3,
  PAGE_BG,
  BORDER,
  BORDER_2,
  BORDER_3,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_DARK_3,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_SOFT,
  TEXT_ON_DARK_MUTED,
  MUTED,
  MUTED_2,
  MUTED_3,
  MUTED_4,
  MUTED_5,
  MUTED_6,
  MUTED_7,
  MUTED_8,
  PLACEHOLDER,
  PURE_WHITE,
  DANGER,
  DANGER_DEEP,
  SUCCESS_GREEN,
});

export type DesignToken = keyof typeof designTokens;
