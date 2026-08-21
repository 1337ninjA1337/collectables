import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AMBER_SOFT,
  BORDER_2,
  CARD_BG_3,
  HERO_DARK,
  HERO_DARK_2,
  MUTED_8,
  RADIUS_PILL,
  SPACING_LIST,
  TEXT_ON_DARK_4,
} from "@/lib/design-tokens";
import { FONT_BODY_EXTRABOLD } from "@/lib/fonts";
import { useI18n } from "@/lib/i18n-context";
import {
  relationshipActions,
  type ProfileSurface,
  type RelationshipActionId,
} from "@/lib/relationship-actions";
import type { ProfileRelationship } from "@/lib/types";

type Props = {
  /** The viewer's relationship to the profile being shown. */
  relationship: ProfileRelationship;
  /** Which screen is asking — a detail page shows more than a list row. */
  surface: ProfileSurface;
  /**
   * Called with the pressed action's INTENT, not with a context method. The
   * screen resolves it through `ACTION_METHOD`, because which of `addFriend` /
   * `removeFriend` / `followProfile` an intent means is the table's decision
   * and which profile id it runs against is the screen's.
   */
  onAction: (id: RelationshipActionId) => void;
  /**
   * Extra nodes rendered before the relationship buttons, inside the same
   * wrapping row — the profile screen's admin "delete profile" button, which
   * shares this row's layout but is not a relationship action and must never
   * enter the table.
   */
  children?: React.ReactNode;
};

/**
 * The buttons a profile offers, rendered.
 *
 * `lib/relationship-actions.ts` made the DECISION single — which buttons, in
 * which order, on which surface — and left the PRESENTATION in two places:
 * `app/people.tsx` and `app/profile/[id].tsx` each declared their own
 * `primaryAction`, `secondaryAction`, `statusBadge` and the three text styles,
 * with the same values, then wrote the same map-and-render block underneath.
 * One layer down from the duplication that extraction removed.
 *
 * The two copies had already drifted, and quietly: the people list set
 * `fontFamily: FONT_BODY_EXTRABOLD` on all three label styles and the profile
 * screen set none, so the same button rendered in DM Sans on one screen and in
 * the platform's default face on the other. Nothing could see it — both files
 * typecheck, both pass the inline-hex and inline-radius guards, and the
 * difference is one property present in one file. Merging the styles picks the
 * named font, which is what every other button in the app uses.
 *
 * `badge` renders as static text rather than a `<Pressable>`: `request_sent`
 * shows "Request sent" beside its cancel button. It is part of what the row
 * says about the relationship, which is why it travels in the same list.
 */
export const RelationshipActionRow = memo(function RelationshipActionRow({
  relationship,
  surface,
  onAction,
  children,
}: Props) {
  const { t } = useI18n();
  const actions = relationshipActions(relationship, surface);

  return (
    <View style={styles.actions}>
      {children}
      {actions.map((action, index) =>
        action.kind === "badge" ? (
          <View key={`${action.id}-${index}`} style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>{t(action.labelKey)}</Text>
          </View>
        ) : (
          <Pressable
            key={`${action.id}-${index}`}
            style={action.kind === "primary" ? styles.primaryAction : styles.secondaryAction}
            onPress={() => onAction(action.id)}
            accessibilityRole="button"
          >
            <Text
              style={
                action.kind === "primary" ? styles.primaryActionText : styles.secondaryActionText
              }
            >
              {t(action.labelKey)}
            </Text>
          </Pressable>
        ),
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING_LIST,
  },
  primaryAction: {
    borderRadius: RADIUS_PILL,
    backgroundColor: HERO_DARK,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryActionText: {
    color: TEXT_ON_DARK_4,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  secondaryAction: {
    borderRadius: RADIUS_PILL,
    backgroundColor: CARD_BG_3,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryActionText: {
    color: HERO_DARK_2,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
  statusBadge: {
    borderRadius: RADIUS_PILL,
    backgroundColor: BORDER_2,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusBadgeText: {
    color: MUTED_8,
    fontWeight: "800",
    fontFamily: FONT_BODY_EXTRABOLD,
  },
});
