import { useCallback, useEffect } from "react";

import { useI18n } from "@/lib/i18n-context";
import { observeStorageFailures, type StorageFailureSite } from "@/lib/report-storage-failure";
import { useToast } from "@/lib/toast-context";

/**
 * One toast, the first time this device's store stops holding what the user does.
 *
 * ## Two silences, one sentence
 *
 * **A refused persist.** Five providers hold a `hydrationSafeToPersist` flag,
 * and a false one means every write is declined for the whole session. The flag
 * exists because the alternative was worse: a store that could not be read used
 * to become an empty state, which the persist effect then wrote OVER the user's
 * real blobs — collections replaced by demo seeds, a paid entitlement replaced
 * by "free", an offline message queue replaced by nothing. Refusing is the fix.
 * What it is not is free: the session that follows looks completely normal and
 * has none of its edits at relaunch.
 *
 * **A rejected write.** `usePersistedBlob` and the nine inline `setItem` catches
 * report to Sentry and return. That is the same loss one layer down and it can
 * start MID-SESSION — a store that filled up while the app was open — so no gate
 * ever closes and nothing at all is different on screen.
 *
 * Both end in "what you are doing now is not being kept", which is why they
 * share a latch and a string rather than being told apart for the user. The
 * DIAGNOSIS differs and goes to Sentry, where somebody can act on it.
 *
 * ## Once per session, across all five providers
 *
 * The latch is MODULE-LEVEL rather than per-provider, because the cause is a
 * device rather than a provider: a store that cannot be read fails every
 * provider that reads it, and five toasts saying the same thing is worse than
 * one. The same shape as `lowProfileCacheTtlWarningShown` in `social-context`,
 * and for the same reason — it must survive a Strict-Mode double-mount and any
 * provider remount, so a `useRef` would not do.
 *
 * It is deliberately NOT reset on sign-out. A device whose store is broken is
 * still broken for the next account, and the second sign-in of a session does
 * not need to be told again.
 *
 * ## Only writes, on the observer half
 *
 * A failed READ reaches the observer too and is deliberately ignored there: a
 * currency preference or a language that could not be read costs the user a
 * default, not their data, and the five reads that DO cost data are the ones
 * whose gate already reports through `refusing`. Saying "changes aren't being
 * saved" because `locale-helpers.getItem` threw would be false.
 */

let noticeShown = false;

/** Test seam: the latch is module-level, so a suite must be able to clear it. */
export function __resetStorageNoticeForTests(): void {
  noticeShown = false;
}

/** Whether the notice has already been raised in this JS realm. */
export function storageNoticeShown(): boolean {
  return noticeShown;
}

/** The half of {@link StorageFailureSite} that means "the user's data did not land". */
export function isWriteFailure(scope: StorageFailureSite): boolean {
  return scope.endsWith(".setItem");
}

/**
 * @param gateRefusing `true` once a hydrate has FINISHED and left the gate shut.
 *
 * Each provider computes this itself, because "finished" differs: the
 * user-scoped four are only refusing when there is an account whose blobs they
 * declined to write (`ready && !hydrationSafeToPersist && !!user`), and
 * `marketplace-context` has one global key and no account at all. Passing the
 * expression rather than deriving it here keeps the signed-out state — where
 * `premium-context` sets `ready` true with the gate legitimately shut — from
 * raising a toast at every launch.
 *
 * The write half needs no argument: it arrives from
 * {@link observeStorageFailures}, so a write that fails in `lib/tombstones.ts`
 * or `lib/sync-cursors.ts` — modules with no React in them at all — reaches the
 * same sentence as one that fails in a provider.
 */
export function useStorageNotice(gateRefusing: boolean): void {
  const toast = useToast();
  const { t } = useI18n();

  const raise = useCallback(() => {
    if (noticeShown) return;
    noticeShown = true;
    toast.error(t("storagePersistRefusedMessage"), t("storagePersistRefusedTitle"));
  }, [t, toast]);

  useEffect(() => {
    if (!gateRefusing) return;
    raise();
  }, [gateRefusing, raise]);

  useEffect(
    () =>
      observeStorageFailures((event) => {
        if (isWriteFailure(event.scope)) raise();
      }),
    [raise],
  );
}
