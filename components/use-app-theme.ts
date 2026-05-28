import { useColorScheme } from "react-native";

import {
  AMBER_ACCENT,
  AMBER_LIGHT,
  AMBER_SOFT,
  BORDER,
  BORDER_2,
  CARD_BG,
  CARD_BG_2,
  CARD_BG_9,
  HERO_DARK,
  HERO_DARK_2,
  HERO_DARK_4,
  HERO_DARK_5,
  MUTED,
  MUTED_14,
  MUTED_19,
  MUTED_20,
  PAGE_BG_2,
  TEXT_DARK,
  TEXT_DARK_5,
  TEXT_ON_DARK,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";

export type AppTheme = {
  isDark: boolean;
  page: string;
  card: string;
  cardElevated: string;
  border: string;
  borderSoft: string;
  hero: string;
  text: string;
  textOnDark: string;
  textSoft: string;
  muted: string;
  meta: string;
  bannerBg: string;
  navBg: string;
  navIconActive: string;
  navIconInactive: string;
};

const LIGHT: AppTheme = {
  isDark: false,
  page: PAGE_BG_2,
  card: CARD_BG,
  cardElevated: CARD_BG_2,
  border: BORDER,
  borderSoft: BORDER_2,
  hero: HERO_DARK,
  text: TEXT_DARK,
  textOnDark: TEXT_ON_DARK,
  textSoft: TEXT_DARK_5,
  muted: MUTED_20,
  meta: MUTED,
  bannerBg: CARD_BG_9,
  navBg: CARD_BG_2,
  navIconActive: HERO_DARK,
  navIconInactive: MUTED_14,
};

const DARK: AppTheme = {
  isDark: true,
  page: HERO_DARK,
  card: HERO_DARK_2,
  cardElevated: HERO_DARK_4,
  border: HERO_DARK_4,
  borderSoft: HERO_DARK_2,
  hero: HERO_DARK_5,
  text: TEXT_ON_DARK,
  textOnDark: TEXT_ON_DARK,
  textSoft: TEXT_ON_DARK_SOFT,
  muted: MUTED_19,
  meta: MUTED_14,
  bannerBg: HERO_DARK_2,
  navBg: HERO_DARK_5,
  navIconActive: AMBER_ACCENT,
  navIconInactive: MUTED_14,
};

export function useAppTheme(): AppTheme {
  const scheme = useColorScheme();
  return scheme === "dark" ? DARK : LIGHT;
}
