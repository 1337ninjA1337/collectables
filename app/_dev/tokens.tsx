/**
 * Dev-only design-tokens preview at `/_dev/tokens`.
 *
 * Renders every named export from `lib/design-tokens.ts` as a labelled
 * swatch (colors), a rounded square (radii) or a horizontal bar (spacing),
 * so designers reviewing PRs can verify visual changes without spelunking
 * through stylesheets.
 *
 * Gated behind `__DEV__`: production builds render a placeholder card
 * instead so the route is harmless if accidentally linked from prod copy.
 */

import { Stack } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/screen";
import {
  AMBER_ACCENT,
  AMBER_SOFT,
  BORDER,
  CARD_BG,
  HERO_DARK,
  MUTED,
  MUTED_5,
  PAGE_BG,
  RADIUS_AVATAR,
  RADIUS_AVATAR_LG,
  RADIUS_CARD,
  RADIUS_CARD_LG,
  RADIUS_CARD_SM,
  RADIUS_INPUT,
  RADIUS_PILL,
  RING_INNER_SIZE,
  RING_MIDDLE_SIZE,
  RING_OUTER_SIZE,
  SPACING_CARD,
  SPACING_INLINE,
  SPACING_LIST,
  SPACING_MICRO,
  SPACING_SECTION,
  SPACING_TIGHT,
  TEXT_DARK,
  TEXT_DARK_3,
  TEXT_ON_DARK,
  designTokens,
} from "@/lib/design-tokens";
import { IconBadge } from "@/components/icon-badge";
import { isDevEnvironment } from "@/lib/dev-menu";
import {
  FONT_BODY,
  FONT_BODY_BOLD,
  FONT_BODY_SEMIBOLD,
  FONT_DISPLAY,
} from "@/lib/fonts";

type ColorGroupId =
  | "Brand / Hero"
  | "Brand / Amber"
  | "Cards & Pages"
  | "Borders"
  | "Text on cream"
  | "Text on dark"
  | "Muted / Placeholder"
  | "Danger"
  | "Status & Utility"
  | "Tag categorical";

const COLOR_GROUPS: { id: ColorGroupId; prefixes: readonly string[]; extras?: readonly string[] }[] = [
  { id: "Brand / Hero", prefixes: ["HERO_DARK"] },
  {
    id: "Brand / Amber",
    prefixes: ["AMBER_ACCENT", "AMBER_LIGHT", "AMBER_SOFT", "AMBER_MUTED", "ACCENT_DEEP"],
  },
  { id: "Cards & Pages", prefixes: ["CARD_BG", "PAGE_BG"] },
  { id: "Borders", prefixes: ["BORDER"] },
  { id: "Text on cream", prefixes: ["TEXT_DARK"] },
  { id: "Text on dark", prefixes: ["TEXT_ON_DARK"] },
  { id: "Muted / Placeholder", prefixes: ["MUTED", "PLACEHOLDER", "PURE_WHITE"] },
  { id: "Danger", prefixes: ["DANGER"] },
  { id: "Status & Utility", prefixes: ["STATUS_", "SUCCESS_", "COOL_GRAY"] },
  { id: "Tag categorical", prefixes: ["TAG_"] },
];

const RADIUS_TOKENS = [
  { name: "RADIUS_AVATAR", value: RADIUS_AVATAR },
  { name: "RADIUS_AVATAR_LG", value: RADIUS_AVATAR_LG },
  { name: "RADIUS_INPUT", value: RADIUS_INPUT },
  { name: "RADIUS_CARD_SM", value: RADIUS_CARD_SM },
  { name: "RADIUS_CARD", value: RADIUS_CARD },
  { name: "RADIUS_CARD_LG", value: RADIUS_CARD_LG },
  { name: "RADIUS_PILL", value: RADIUS_PILL },
] as const;

const SPACING_TOKENS = [
  { name: "SPACING_MICRO", value: SPACING_MICRO },
  { name: "SPACING_TIGHT", value: SPACING_TIGHT },
  { name: "SPACING_INLINE", value: SPACING_INLINE },
  { name: "SPACING_LIST", value: SPACING_LIST },
  { name: "SPACING_CARD", value: SPACING_CARD },
  { name: "SPACING_SECTION", value: SPACING_SECTION },
] as const;

const RING_TOKENS = [
  { name: "RING_OUTER_SIZE", value: RING_OUTER_SIZE },
  { name: "RING_MIDDLE_SIZE", value: RING_MIDDLE_SIZE },
  { name: "RING_INNER_SIZE", value: RING_INNER_SIZE },
] as const;

function isLightHex(hex: string): boolean {
  // Quick luminance approximation so the swatch label picks a readable colour.
  const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
  if (cleaned.length !== 6) return true;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return true;
  // Rec. 601 luma — works well enough for a swatch label.
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  return luma > 160;
}

function groupColorTokens(): { id: ColorGroupId; entries: { name: string; value: string }[] }[] {
  const allEntries = Object.entries(designTokens).filter(([, value]) => typeof value === "string");
  const claimed = new Set<string>();
  const groups: { id: ColorGroupId; entries: { name: string; value: string }[] }[] = [];

  for (const group of COLOR_GROUPS) {
    const entries: { name: string; value: string }[] = [];
    for (const [name, value] of allEntries) {
      if (claimed.has(name)) continue;
      const matches = group.prefixes.some((prefix) => name === prefix || name.startsWith(prefix));
      if (matches) {
        claimed.add(name);
        entries.push({ name, value: value as string });
      }
    }
    if (entries.length > 0) groups.push({ id: group.id, entries });
  }

  // Catch-all bucket so any token we forgot to categorise still renders.
  const orphans: { name: string; value: string }[] = [];
  for (const [name, value] of allEntries) {
    if (!claimed.has(name)) orphans.push({ name, value: value as string });
  }
  if (orphans.length > 0) {
    groups.push({ id: "Status & Utility", entries: orphans });
  }
  return groups;
}

export default function TokensPreviewScreen() {
  const isDev = isDevEnvironment();
  const colorGroups = useMemo(() => groupColorTokens(), []);

  if (!isDev) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Tokens preview" }} />
        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderTitle}>Tokens preview</Text>
          <Text style={styles.placeholderText}>
            This route is only available in development builds. Run the app
            with `npm start` (or any other Expo dev command) to inspect the
            design-tokens palette.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Tokens preview" }} />

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Design tokens</Text>
        <Text style={styles.heroText}>
          Every named export from `lib/design-tokens.ts` rendered as a swatch.
          Use this route in dev to verify palette + geometry changes.
        </Text>
      </View>

      {colorGroups.map((group) => (
        <View key={group.id} style={styles.section}>
          <Text style={styles.sectionTitle}>{group.id}</Text>
          <View style={styles.swatchGrid}>
            {group.entries.map((token) => {
              const labelColor = isLightHex(token.value) ? TEXT_DARK : TEXT_ON_DARK;
              return (
                <View key={token.name} style={styles.swatchWrap}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: token.value },
                    ]}
                  >
                    <Text style={[styles.swatchName, { color: labelColor }]}>{token.name}</Text>
                    <Text style={[styles.swatchValue, { color: labelColor }]}>{token.value}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Radius</Text>
        <View style={styles.radiusRow}>
          {RADIUS_TOKENS.map((token) => (
            <View key={token.name} style={styles.radiusItem}>
              <View
                style={[
                  styles.radiusBox,
                  { borderRadius: token.value },
                ]}
              />
              <Text style={styles.radiusName}>{token.name}</Text>
              <Text style={styles.radiusValue}>{token.value}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Spacing</Text>
        <View style={styles.spacingList}>
          {SPACING_TOKENS.map((token) => (
            <View key={token.name} style={styles.spacingItem}>
              <Text style={styles.spacingName}>{token.name}</Text>
              <View style={[styles.spacingBar, { width: token.value * 8 }]} />
              <Text style={styles.spacingValue}>{token.value}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Icon-badge rings</Text>
        <View style={styles.ringRow}>
          <IconBadge icon="📦" />
          <View style={styles.spacingList}>
            {RING_TOKENS.map((token) => (
              <View key={token.name} style={styles.spacingItem}>
                <Text style={styles.spacingName}>{token.name}</Text>
                <Text style={styles.spacingValue}>{token.value}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: HERO_DARK,
    borderRadius: RADIUS_CARD_LG,
    padding: 20,
    gap: SPACING_INLINE,
  },
  heroTitle: {
    fontSize: 28,
    color: TEXT_ON_DARK,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY,
  },
  heroText: {
    color: TEXT_ON_DARK,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_BODY,
  },
  section: {
    gap: SPACING_SECTION,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_DISPLAY,
  },
  swatchGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING_LIST,
  },
  swatchWrap: {
    width: 160,
  },
  swatch: {
    borderRadius: RADIUS_CARD_SM,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 76,
    gap: SPACING_MICRO,
    justifyContent: "center",
  },
  swatchName: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  swatchValue: {
    fontSize: 11,
    fontFamily: FONT_BODY,
  },
  radiusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING_LIST,
  },
  radiusItem: {
    width: 96,
    alignItems: "center",
    gap: SPACING_MICRO,
  },
  radiusBox: {
    width: 72,
    height: 72,
    backgroundColor: AMBER_ACCENT,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  radiusName: {
    fontSize: 11,
    color: TEXT_DARK_3,
    fontFamily: FONT_BODY_SEMIBOLD,
    textAlign: "center",
  },
  radiusValue: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FONT_BODY,
  },
  spacingList: {
    gap: SPACING_INLINE,
  },
  ringRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_CARD,
  },
  spacingItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING_TIGHT,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS_CARD_SM,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  spacingName: {
    width: 140,
    color: TEXT_DARK_3,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: FONT_BODY_BOLD,
  },
  spacingBar: {
    height: 8,
    backgroundColor: AMBER_ACCENT,
    borderRadius: RADIUS_PILL,
  },
  spacingValue: {
    marginLeft: "auto",
    color: MUTED_5,
    fontSize: 12,
    fontFamily: FONT_BODY,
  },
  placeholderCard: {
    backgroundColor: PAGE_BG,
    borderRadius: RADIUS_CARD,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 24,
    gap: SPACING_INLINE,
  },
  placeholderTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: TEXT_DARK,
    fontFamily: FONT_DISPLAY,
  },
  placeholderText: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_BODY,
  },
});
