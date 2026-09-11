import { StyleSheet, Text, View } from "react-native";

import { useChat } from "@/lib/chat-context";
import { useCollections } from "@/lib/collections-context";
import { AMBER_SOFT, AMBER_SOFT_4, MUTED_25, RADIUS_PILL } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useSocial } from "@/lib/social-context";

/**
 * BE-16: a localised "Syncing N changes…" pill that surfaces unflushed offline
 * mutations. It sums the pending-mutation counts every write context already
 * exposes — collection/item upserts (`useCollections`), social-graph mutations
 * (`useSocial`) and outbound chat messages (`useChat`) — and renders only while
 * at least one write is still parked awaiting (re)delivery to the cloud.
 *
 * Mirrors the `realtimeOnline`-driven {@link RealtimeStatusPill}: a single
 * dismissible affordance that disappears the moment the queues drain, so a
 * fully-synced app isn't decorated with a misleading badge. Must be rendered
 * inside the Social/Collections/Chat providers (i.e. within `AppShell`).
 *
 * ## The pill announces itself, and the wrapper is why it can
 *
 * A user who cannot see it had no way to learn that a write was parked: the
 * pill appeared, sat there, and vanished, all silently. It is a STATUS rather
 * than an interruption — nobody needs to be cut off mid-sentence to hear that
 * three changes are queued — so it is a polite live region rather than a call
 * to `announceMessage`, which writes the app's one assertive channel.
 *
 * The always-rendered wrapper is the whole mechanism. A live region announces
 * a CHANGE to text it already had; a node carrying `aria-live` that is
 * inserted with its text already in it is usually not announced at all, which
 * is the same lesson `lib/announce.web.ts` opens with. So the region is in the
 * tree from the first render and the pill moves in and out of it. Empty, it
 * carries no style and costs no layout.
 *
 * Both spellings, because the platforms disagree on the name:
 * react-native-web forwards `aria-live` to the DOM node and Android reads
 * `accessibilityLiveRegion`. iOS has no live regions at all, and nothing here
 * can give it one.
 */
export function SyncStatusPill() {
  const { pendingSyncCount: collectionsPending } = useCollections();
  const { pendingSyncCount: socialPending } = useSocial();
  const { pendingSyncCount: chatPending } = useChat();
  const { t } = useI18n();

  const total = collectionsPending + socialPending + chatPending;

  return (
    <View aria-live="polite" accessibilityLiveRegion="polite">
      {total <= 0 ? null : (
        <View
          style={styles.pill}
          accessibilityRole="text"
          accessibilityLabel={t("syncingPillA11y", { count: total })}
        >
          <Text style={styles.pillText}>{t("syncingPill", { count: total })}</Text>
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
