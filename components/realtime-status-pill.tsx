import { StyleSheet, Text, View } from "react-native";

import { AMBER_SOFT, AMBER_SOFT_4, MUTED_25, RADIUS_PILL } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useOptionalRealtimeStatus } from "@/lib/realtime-status-context";

/**
 * Localised "Offline · reconnecting" pill driven by the shared realtime
 * status context. Renders nothing when the socket is online or when no
 * subscription is active (`idle`) so a screen with no live data isn't
 * decorated with a misleading offline badge.
 *
 * Mirrors the inline pill in `app/chat/[id].tsx`, but pulled out so screens
 * that don't own their own realtime subscription (marketplace, future
 * profile-presence) can render the same affordance without re-wiring a
 * status listener.
 */
export function RealtimeStatusPill() {
  const status = useOptionalRealtimeStatus();
  const { t } = useI18n();
  if (!status) return null;
  if (status.connectionState !== "connecting") return null;
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{t("chatOfflinePill")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS_PILL,
    backgroundColor: AMBER_SOFT_4,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  pillText: {
    color: MUTED_25,
    fontSize: 12,
    fontWeight: "700",
  },
});
