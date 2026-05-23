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
export const AMBER_SOFT_2 = "#e0b87a";
export const AMBER_MUTED = "#d9c2a8";
export const AMBER_MUTED_2 = "#dbc7ae";
export const ACCENT_DEEP = "#8a5a2b";

export const CARD_BG = "#fffaf3";
export const CARD_BG_2 = "#fff7ef";
export const CARD_BG_3 = "#fff1df";
export const CARD_BG_4 = "#fff0d6";
export const CARD_BG_5 = "#efe1cf";
export const CARD_BG_6 = "#fff3e0";
export const PAGE_BG = "#fff8ef";
export const PAGE_BG_2 = "#fffaf4";

export const BORDER = "#eadbc8";
export const BORDER_2 = "#f0e2cf";
export const BORDER_3 = "#f0e4d0";
export const BORDER_4 = "#e4d5c4";

export const TEXT_DARK = "#2f2318";
export const TEXT_DARK_2 = "#241912";
export const TEXT_DARK_3 = "#2d2117";
export const TEXT_DARK_4 = "#2b2017";
export const TEXT_ON_DARK = "#fff7ef";
export const TEXT_ON_DARK_2 = "#fff5ea";
export const TEXT_ON_DARK_3 = "#fff8ef";
export const TEXT_ON_DARK_4 = "#fff4e8";
export const TEXT_ON_DARK_5 = "#fff7ea";
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
export const MUTED_9 = "#6d5645";
export const MUTED_10 = "#624a35";
export const MUTED_11 = "#6f5a44";
export const MUTED_12 = "#7a4f1a";
export const MUTED_13 = "#8a6e54";
export const MUTED_14 = "#a08970";
export const MUTED_15 = "#b8a08a";
export const MUTED_16 = "#a89480";
export const MUTED_17 = "#7a6453";
export const PLACEHOLDER = "#9b8571";

export const PURE_WHITE = "#ffffff";

export const DANGER = "#d92f2f";
export const DANGER_DEEP = "#a13434";
export const SUCCESS_GREEN = "#3a7d4f";
export const STATUS_ONLINE = "#22c55e";
export const STATUS_OFFLINE = "#eab308";

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
  AMBER_SOFT_2,
  AMBER_MUTED,
  AMBER_MUTED_2,
  ACCENT_DEEP,
  CARD_BG,
  CARD_BG_2,
  CARD_BG_3,
  CARD_BG_4,
  CARD_BG_5,
  CARD_BG_6,
  PAGE_BG,
  PAGE_BG_2,
  BORDER,
  BORDER_2,
  BORDER_3,
  BORDER_4,
  TEXT_DARK,
  TEXT_DARK_2,
  TEXT_DARK_3,
  TEXT_DARK_4,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_4,
  TEXT_ON_DARK_5,
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
  MUTED_9,
  MUTED_10,
  MUTED_11,
  MUTED_12,
  MUTED_13,
  MUTED_14,
  MUTED_15,
  MUTED_16,
  MUTED_17,
  PLACEHOLDER,
  PURE_WHITE,
  DANGER,
  DANGER_DEEP,
  SUCCESS_GREEN,
  STATUS_ONLINE,
  STATUS_OFFLINE,
});

export type DesignToken = keyof typeof designTokens;
