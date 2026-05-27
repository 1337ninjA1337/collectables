import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/lib/auth-context";
import { useCollections } from "@/lib/collections-context";
import { confirmDialog } from "@/lib/confirm-dialog";
import {
  AMBER_ACCENT,
  AMBER_SOFT,
  BORDER,
  CARD_BG,
  DANGER,
  HERO_DARK,
  MUTED,
  PAGE_BG_2,
  TEXT_DARK,
  TEXT_ON_DARK,
  TEXT_ON_DARK_2,
} from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useMarketplace } from "@/lib/marketplace-context";
import { useSocial } from "@/lib/social-context";
import { useToast } from "@/lib/toast-context";

/**
 * Head-of-queue prompt that fires when the seller's device receives a
 * realtime UPDATE telling them their listing was just claimed. Offers
 * three resolutions for the underlying item in the seller's collection:
 *   - Archive (soft-hide, keep for stats / audit)
 *   - Delete (hard remove)
 *   - Keep (dismiss with no side-effect)
 *
 * Mounted once at app shell level so any active screen surfaces the
 * prompt over its content.
 */
export function SoldListingPrompt() {
  const { sellerNotifications, dismissSellerNotification, getListingById } =
    useMarketplace();
  const { getItemById, archiveItem, deleteItem } = useCollections();
  const { getProfileById } = useSocial();
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();

  // Only render the head of the queue; subsequent notifications wait their
  // turn so the user is never overwhelmed by stacked modals.
  const listingId = sellerNotifications[0];
  if (!listingId || !user) return null;

  const listing = getListingById(listingId);
  if (!listing || listing.ownerUserId !== user.id || !listing.soldAt) {
    // Listing dropped from local state (race) or no longer belongs to me —
    // safe-clear and skip rendering.
    return <SoldListingPromptCleanup id={listingId} />;
  }

  const item = getItemById(listing.itemId);
  const itemTitle = item?.title ?? "";
  const buyer = listing.buyerUserId ? getProfileById(listing.buyerUserId) : undefined;
  const buyerName = buyer?.username
    ? `@${buyer.username}`
    : buyer?.displayName ?? t("unknownUser");

  async function handleArchive() {
    if (item) {
      await archiveItem(item.id);
      toast.success(t("marketplaceSoldPromptItemArchived"));
    }
    dismissSellerNotification(listingId);
  }

  async function handleDelete() {
    const ok = await confirmDialog({
      title: t("marketplaceSoldPromptConfirmDeleteTitle"),
      body: t("marketplaceSoldPromptConfirmDeleteBody"),
      confirmLabel: t("marketplaceSoldPromptDelete"),
      cancelLabel: t("cancel"),
      destructive: true,
    });
    if (!ok) return;
    if (item) {
      await deleteItem(item.id);
      toast.success(t("marketplaceSoldPromptItemDeleted"));
    }
    dismissSellerNotification(listingId);
  }

  function handleKeep() {
    dismissSellerNotification(listingId);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleKeep}>
      <Pressable style={styles.backdrop} onPress={handleKeep}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{t("marketplaceSoldPromptTitle")}</Text>
          <Text style={styles.body}>
            {t("marketplaceSoldPromptBody", {
              buyer: buyerName,
              title: itemTitle,
            })}
          </Text>

          <Pressable style={styles.actionPrimary} onPress={handleArchive}>
            <Text style={styles.actionPrimaryLabel}>
              {t("marketplaceSoldPromptArchive")}
            </Text>
            <Text style={styles.actionHint}>
              {t("marketplaceSoldPromptArchiveHint")}
            </Text>
          </Pressable>

          <Pressable style={styles.actionDanger} onPress={handleDelete}>
            <Text style={styles.actionPrimaryLabel}>
              {t("marketplaceSoldPromptDelete")}
            </Text>
            <Text style={styles.actionHint}>
              {t("marketplaceSoldPromptDeleteHint")}
            </Text>
          </Pressable>

          <Pressable style={styles.actionGhost} onPress={handleKeep}>
            <Text style={styles.actionGhostLabel}>
              {t("marketplaceSoldPromptKeep")}
            </Text>
            <Text style={styles.actionHintMuted}>
              {t("marketplaceSoldPromptKeepHint")}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SoldListingPromptCleanup({ id }: { id: string }) {
  const { dismissSellerNotification } = useMarketplace();
  // Side-effect on mount; React 18 strict-mode double-invokes cleanup but
  // the filter-by-id is idempotent so the second call is a no-op.
  dismissSellerNotification(id);
  return null;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(38, 27, 20, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: PAGE_BG_2,
    borderRadius: 24,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: AMBER_SOFT,
  },
  title: {
    color: TEXT_DARK,
    fontSize: 18,
    fontWeight: "800",
  },
  body: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },
  actionPrimary: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: AMBER_ACCENT,
  },
  actionDanger: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: DANGER,
  },
  actionGhost: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  actionPrimaryLabel: {
    color: TEXT_ON_DARK_2,
    fontSize: 15,
    fontWeight: "800",
  },
  actionGhostLabel: {
    color: HERO_DARK,
    fontSize: 15,
    fontWeight: "800",
  },
  actionHint: {
    color: TEXT_ON_DARK,
    opacity: 0.85,
    fontSize: 12,
    marginTop: 4,
  },
  actionHintMuted: {
    color: MUTED,
    fontSize: 12,
    marginTop: 4,
  },
});
