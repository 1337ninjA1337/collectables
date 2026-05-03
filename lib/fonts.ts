export const FONT_DISPLAY = "Syne-ExtraBold" as const;
export const FONT_DISPLAY_BOLD = "Syne-Bold" as const;
export const FONT_BODY = "DMSans-Regular" as const;
export const FONT_BODY_SEMIBOLD = "DMSans-SemiBold" as const;
export const FONT_BODY_BOLD = "DMSans-Bold" as const;
export const FONT_BODY_EXTRABOLD = "DMSans-ExtraBold" as const;

export type AppFont =
  | typeof FONT_DISPLAY
  | typeof FONT_DISPLAY_BOLD
  | typeof FONT_BODY
  | typeof FONT_BODY_SEMIBOLD
  | typeof FONT_BODY_BOLD
  | typeof FONT_BODY_EXTRABOLD;
