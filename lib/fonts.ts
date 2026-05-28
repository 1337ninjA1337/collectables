import { Platform } from "react-native";

export const FONT_DISPLAY = "Syne-ExtraBold" as const;
export const FONT_DISPLAY_BOLD = "Syne-Bold" as const;
export const FONT_BODY = "DMSans-Regular" as const;
export const FONT_BODY_SEMIBOLD = "DMSans-SemiBold" as const;
export const FONT_BODY_BOLD = "DMSans-Bold" as const;
export const FONT_BODY_EXTRABOLD = "DMSans-ExtraBold" as const;

/**
 * Editorial display family — system serif chain, no asset cost.
 * Used on hero titles, section titles, card titles, item titles.
 * Each platform resolves to an OS-bundled serif:
 *   iOS:     "Iowan Old Style" (San Francisco serif companion, very legible)
 *   Android: "serif" generic family
 *   Web:     full CSS fallback chain
 */
export const FONT_DISPLAY_EDITORIAL = Platform.select({
  ios: "Iowan Old Style",
  android: "serif",
  web: '"Iowan Old Style", "Charter", Georgia, "Cambria", "Times New Roman", serif',
  default: "serif",
}) as string;

export type AppFont =
  | typeof FONT_DISPLAY
  | typeof FONT_DISPLAY_BOLD
  | typeof FONT_BODY
  | typeof FONT_BODY_SEMIBOLD
  | typeof FONT_BODY_BOLD
  | typeof FONT_BODY_EXTRABOLD
  | typeof FONT_DISPLAY_EDITORIAL;
