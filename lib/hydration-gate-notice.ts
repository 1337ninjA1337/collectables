import { useEffect } from "react";

import { useI18n } from "@/lib/i18n-context";
import { useToast } from "@/lib/toast-context";

/**
 * One toast, the first time a hydration gate refuses to persist.
 *
 * ## The silence this ends
 *
 * Five providers hold a `hydrationSafeToPersist` flag. It exists because the
 * alternative was worse: a store that could not be read used to become an empty
 * state, which the persist effect then wrote OVER the user's real blobs —
 * collections replaced by demo seeds, a paid entitlement replaced by "free", an
 * offline message queue replaced by nothing. Refusing to write is the fix, and
 * it is correct.
 *
 * What it is not is free. A session behind a closed gate looks completely
 * normal: the user edits collections, the UI updates, the toast-less app says
 * nothing, and the next launch has none of it. That is still data loss from
 * their side — quieter, smaller, and entirely invisible. Four runs filed this
 * as the missing half of the gate; this is it.
 *
 * ## Once per session, across all five
 *
 * The latch is MODULE-LEVEL rather than per-provider, because the cause is a
 * device store rather than a provider: a store that cannot be read fails every
 * provider that reads it, and five toasts saying the same thing is worse than
 * one. The same shape as `lowProfileCacheTtlWarningShown` in `social-context`,
 * and for the same reason — it must survive a Strict-Mode double-mount and any
 * provider remount, so a `useRef` would not do.
 *
 * It is deliberately NOT reset on sign-out. A device whose store is broken is
 * still broken for the next account, and the second sign-in of a session does
 * not need to be told again.
 *
 * ## What it does not cover
 *
 * A rejected WRITE. That path already reports to Sentry through
 * `reportStorageFailure` and, unlike this one, the user's edits reached the
 * store on earlier writes — the failure is partial. The gate is the case where
 * NOTHING is written for the whole session, which is the one worth interrupting
 * somebody for.
 */

let noticeShown = false;

/** Test seam: the latch is module-level, so a suite must be able to clear it. */
export function __resetHydrationGateNoticeForTests(): void {
  noticeShown = false;
}

/** Whether the notice has already been raised in this JS realm. */
export function hydrationGateNoticeShown(): boolean {
  return noticeShown;
}

/**
 * @param refusing `true` once a hydrate has FINISHED and left the gate closed.
 *
 * Each provider computes this itself, because "finished" differs: the
 * user-scoped four are only refusing when there is an account whose blobs they
 * declined to write (`ready && !hydrationSafeToPersist && !!user`), and
 * `marketplace-context` has one global key and no account at all. Passing the
 * expression rather than deriving it here keeps the signed-out state — where
 * `ready` is true and the gate is legitimately shut — from raising a toast at
 * every launch.
 */
export function useHydrationGateNotice(refusing: boolean): void {
  const toast = useToast();
  const { t } = useI18n();

  useEffect(() => {
    if (!refusing || noticeShown) return;
    noticeShown = true;
    toast.error(t("storagePersistRefusedMessage"), t("storagePersistRefusedTitle"));
  }, [refusing, t, toast]);
}
