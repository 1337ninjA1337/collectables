import { StyleSheet, Text, View } from "react-native";

import { CONNECTION_NOTICE_KEYS } from "@/lib/connection-notice";
import { AMBER_SOFT, AMBER_SOFT_4, MUTED_25, RADIUS_PILL } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useOptionalRealtimeStatus } from "@/lib/realtime-status-context";
import { useConnectionNotice } from "@/lib/use-connection-notice";

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
 *
 * ## Going offline is said out loud, politely
 *
 * A user who cannot see the pill had no way to learn the socket had dropped —
 * their messages simply stopped arriving. It is a status rather than an
 * interruption, so it is a polite live region rather than the app's one
 * assertive channel; see `components/sync-status-pill.tsx` for why the region
 * has to be in the tree BEFORE the pill appears in it, and for why both
 * spellings of the prop are given.
 *
 * The outer `null` stays outside the region: a screen with no realtime
 * subscription has no connection to have an opinion about, which is not the
 * same fact as a connection that is up.
 *
 * ## And it says when the connection comes back
 *
 * The pill used to simply vanish, which a sighted user correctly reads as
 * "fixed" and which is announced by nothing at all — text becoming empty is
 * not a sentence. So the user who most needed telling was told the connection
 * broke and never told it worked again. `lib/connection-notice.ts` owns the
 * transition and why a session that starts online has not reconnected.
 */
export function RealtimeStatusPill() {
  const status = useOptionalRealtimeStatus();
  const { t } = useI18n();
  // Hooks run before the early return can be reached, so the notice is asked
  // for even on a screen with no subscription — `false` there would claim the
  // connection is down. `idle` and `online` are both "not offline".
  const notice = useConnectionNotice(status?.connectionState !== "connecting");
  if (!status) return null;
  return (
    <View aria-live="polite" accessibilityLiveRegion="polite">
      {notice === null ? null : (
        <View style={styles.pill} accessibilityRole="text">
          <Text style={styles.pillText}>
            {t(CONNECTION_NOTICE_KEYS[notice])}
          </Text>
        </View>
      )}
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
