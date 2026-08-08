import { Link, type Href } from "expo-router";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/components/use-app-theme";
import {
  AMBER_ACCENT,
  AMBER_SOFT,
  HERO_DARK,
  RADIUS_CARD,
  RADIUS_CARD_SM,
  SHADOW_SOFT,
  SPACING_SECTION,
  TEXT_ON_DARK,
  TEXT_ON_DARK_5,
} from "@/lib/design-tokens";
import { FONT_BODY, FONT_BODY_EXTRABOLD } from "@/lib/fonts";

/**
 * `"amber"` is the promotional treatment (amber icon disc, amber border, the
 * warm `bannerBg` surface); `"dark"` is the neutral one (dark icon disc, the
 * ordinary card surface + border). Tone drives THREE coupled values — surface,
 * border and icon disc — which is exactly why it is one prop and not three.
 */
export type DashboardTone = "amber" | "dark";

type Props = {
  /** Route the whole row navigates to. */
  href: Href;
  /** Single glyph rendered in the disc — "★", "⊞", … */
  icon: string;
  /** Row headline. Already localized by the caller. */
  title: string;
  /** Supporting line under the headline. Already localized. */
  hint: string;
  tone?: DashboardTone;
};

/**
 * The "icon disc + title + hint + chevron" row the home dashboard uses to
 * point at the wishlist and the stats screen.
 *
 * The two copies were the same 40 lines of stylesheet twice over, differing
 * only in the three values that make up the tone plus one accident: the icon
 * glyph rendered at `fontSize: 22` in the wishlist row and `20` in the stats
 * row, with nothing to justify the difference. Unified at 22 here.
 *
 * Two structural notes:
 *
 * The component owns its `<Link asChild>` rather than being wrapped in one by
 * the caller. `Link asChild` renders its child through Radix's `Slot`, which
 * clones the child with `href`/`onPress` props — a plain function component in
 * that position would have to forward them by hand, and forgetting to is a
 * silently dead row rather than a type error. Taking `href` as a prop keeps the
 * Link and the Pressable adjacent in one file.
 *
 * The Pressable's style is an object spread, never an array. `Slot.mergeProps`
 * merges styles with a plain object spread, so an array style arrives at the
 * DOM as `{0: …, 1: …}` and React DOM throws on `node.style[0] = …`. That crash
 * took the whole web build down once already; `link-aschild-style-flatten.test.ts`
 * is the repo-wide guard and this component stays on its right side.
 */
export const DashboardBanner = memo(function DashboardBanner({
  href,
  icon,
  title,
  hint,
  tone = "dark",
}: Props) {
  const theme = useAppTheme();
  const amber = tone === "amber";

  return (
    <Link href={href} asChild>
      <Pressable
        style={{
          ...styles.banner,
          backgroundColor: amber ? theme.bannerBg : theme.card,
          borderColor: amber ? AMBER_SOFT : theme.border,
          ...SHADOW_SOFT,
        }}
      >
        <View style={{ ...styles.icon, backgroundColor: amber ? AMBER_ACCENT : HERO_DARK }}>
          <Text style={{ ...styles.iconText, color: amber ? TEXT_ON_DARK_5 : TEXT_ON_DARK }}>
            {icon}
          </Text>
        </View>
        <View style={styles.body}>
          <Text style={{ ...styles.title, color: theme.text }}>{title}</Text>
          <Text style={{ ...styles.hint, color: theme.meta }}>{hint}</Text>
        </View>
        <Text style={{ ...styles.arrow, color: theme.meta }}>›</Text>
      </Pressable>
    </Link>
  );
});

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_SECTION,
    borderRadius: RADIUS_CARD_SM,
    padding: 16,
    borderWidth: 1,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS_CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 22,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  hint: {
    fontSize: 13,
    marginTop: 2,
    fontFamily: FONT_BODY,
  },
  arrow: {
    fontSize: 28,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
