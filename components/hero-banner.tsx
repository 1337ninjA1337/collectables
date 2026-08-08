import { LinearGradient } from "expo-linear-gradient";
import { memo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  AMBER_LIGHT,
  HERO_DARK,
  RADIUS_HERO_LG,
  SPACING_GUTTER,
  SPACING_LIST,
  TEXT_ON_DARK_3,
  TEXT_ON_DARK_SOFT,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_EXTRABOLD, FONT_DISPLAY_EDITORIAL } from "@/lib/fonts";
import { HERO_DARK_GRADIENT } from "@/lib/gradients";

/**
 * `"gradient"` is the flagship banner (home, settings, login); `"solid"` is
 * the flat `HERO_DARK` variant the secondary screens use. Tone is the ONLY
 * axis that varies — everything else (radius, padding, gap, typography) is
 * identical, which is what makes one component honest here.
 */
export type HeroTone = "gradient" | "solid";

type Props = {
  /** Small uppercase kicker above the title. Already localized by the caller. */
  eyebrow: string;
  /** The banner headline. Announced as a header to screen readers. */
  title: string;
  /** Optional supporting line under the title (settings has none). */
  subtitle?: string;
  /** Background treatment. Defaults to the gradient. */
  tone?: HeroTone;
  /**
   * Rendered BETWEEN the eyebrow and the title — the home screen's profile +
   * settings/sign-out row sits there. A separate slot rather than `children`
   * because the ordering is the recipe: a row appended after the copy would
   * push the account controls below the fold on a short viewport.
   */
  headerSlot?: ReactNode;
  /** Rendered below the copy — the home screen's actions row. */
  children?: ReactNode;
};

/**
 * The dark banner at the top of eight screens: home, settings and login (dark
 * gradient), plus people, friends, chats, marketplace and the collections feed
 * (flat `HERO_DARK`).
 *
 * All eight hand-rolled the same `eyebrow + title (+ subtitle)` block with
 * private copies of the styles, and the copies had drifted apart on every axis
 * that exists. Resolved here by simple majority across all eight:
 *
 *   - `gap`: `SPACING_LIST` (6 screens) over `SPACING_CARD` (home, login)
 *   - `borderRadius`: `RADIUS_HERO_LG` (5) over a bare `32` literal (login,
 *     friends, collections-feed) — the same number, but a literal is invisible
 *     to a retheme and to `npm run lint:radius`
 *   - `padding`: all eight were `24`; only home routed it through
 *     `SPACING_GUTTER`
 *   - title size: `28`/`36` (6) over `32`/`38` (home) and `30`/`38` (login)
 *   - title font: `FONT_DISPLAY_EDITORIAL` (5) over `FONT_DISPLAY` (login,
 *     friends) and over *nothing at all* on the collections feed, whose
 *     headline silently rendered in the platform default face
 *   - title colour: `TEXT_ON_DARK_3` (7) over marketplace's `PAGE_BG` — two
 *     near-identical creams, one of them semantically a page background
 *   - eyebrow font: `FONT_BODY_EXTRABOLD`, which chats, marketplace and the
 *     collections feed had simply omitted, so their kickers rendered in the
 *     system face beside DM Sans siblings
 *   - subtitle: `TEXT_ON_DARK_SOFT` everywhere, but `fontSize` was declared on
 *     only two of seven (the rest inherited React Native's default 14) and
 *     `FONT_BODY` on four
 *
 * There is deliberately NO `style` prop. An override slot would let the next
 * screen re-open every one of those drifts while still reading as an adoption
 * in review; the point of the extraction is that the recipe has exactly one
 * declaration, so a screen that genuinely needs a different banner should
 * declare a different banner.
 *
 * `accessibilityRole="header"` on the title is new — none of the eight copies
 * had it, so screen-reader users had no landmark to jump to and had to swipe
 * the banner linearly. Baked in here rather than passed as a prop for the same
 * reason `<SheetSearchRow>` bakes in its a11y: it is identical at every call
 * site, and a per-consumer prop is just eight copies waiting to drift.
 */
export const HeroBanner = memo(function HeroBanner({
  eyebrow,
  title,
  subtitle,
  tone = "gradient",
  headerSlot,
  children,
}: Props) {
  const body = (
    <>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      {headerSlot}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle == null ? null : <Text style={styles.subtitle}>{subtitle}</Text>}
      {children}
    </>
  );

  if (tone === "solid") {
    return <View style={{ ...styles.hero, ...styles.heroSolid }}>{body}</View>;
  }

  return (
    <LinearGradient {...HERO_DARK_GRADIENT} style={styles.hero}>
      {body}
    </LinearGradient>
  );
});

const styles = StyleSheet.create({
  hero: {
    borderRadius: RADIUS_HERO_LG,
    padding: SPACING_GUTTER,
    gap: SPACING_LIST,
  },
  heroSolid: {
    backgroundColor: HERO_DARK,
  },
  eyebrow: {
    color: AMBER_LIGHT,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  title: {
    color: TEXT_ON_DARK_3,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY_EDITORIAL,
  },
  subtitle: {
    color: TEXT_ON_DARK_SOFT,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FONT_BODY,
  },
});
