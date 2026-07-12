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
 */
export function SyncStatusPill() {
  const { pendingSyncCount: collectionsPending } = useCollections();
  const { pendingSyncCount: socialPending } = useSocial();
  const { pendingSyncCount: chatPending } = useChat();
  const { t } = useI18n();

  const total = collectionsPending + socialPending + chatPending;
  if (total <= 0) return null;

  return (
    <View
      style={styles.pill}
      accessibilityRole="text"
      accessibilityLabel={t("syncingPillA11y", { count: total })}
    >
      <Text style={styles.pillText}>{t("syncingPill", { count: total })}</Text>
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
