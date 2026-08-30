import { useCallback, useEffect } from "react";
import { Platform } from "react-native";

import { useI18n } from "@/lib/i18n-context";
import {
  observeStorageFailures,
  STORAGE_FAILURE_SITES,
  type StorageFailureReason,
  type StorageFailureSite,
} from "@/lib/report-storage-failure";
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
 * share a latch and a TITLE rather than being told apart for the user. What
 * differs is the fix, and only where the error is clear about it: a rejected
 * write carrying a quota signal says "free up space", everything else says
 * "the storage is not available". The full DIAGNOSIS still goes to Sentry,
 * where somebody can act on more than one sentence of it.
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
 * ## Two hooks, because the two halves have different multiplicities
 *
 * The gate half is PER PROVIDER — each one computes its own "a hydrate has
 * finished and left the gate shut", and that expression cannot be derived here
 * (see {@link useStorageNotice}). The write half is PER DEVICE: it arrives
 * through a module-level registry that already carries every call site in the
 * tree, so subscribing from the same hook meant five providers each adding a
 * closure to that registry to raise, between them, one latched toast. Four of
 * those five subscriptions did nothing but pay for themselves.
 *
 * {@link useStorageFailureNotice} is that half, mounted exactly once by
 * `components/storage-notice.tsx` beside `ToastProvider`. Splitting it also
 * makes the write half independent of whether a user is signed in: the
 * providers unmount around an account switch, and a store that fills up during
 * one would previously have been heard by whichever of them happened to be
 * mounted.
 *
 * ## Only writes that cost the user something, on the observer half
 *
 * A failed READ reaches the observer too and is deliberately ignored there: a
 * currency preference or a language that could not be read costs the user a
 * default, not their data, and the five reads that DO cost data are the ones
 * whose gate already reports through `refusing`. Saying "changes aren't being
 * saved" because `locale-helpers.getItem` threw would be false.
 *
 * The same judgement applies to three WRITES, which is the half that was
 * missing: a language, a currency and a cached FX table are a preference and a
 * derived cache. One that will not persist costs the user a default at the next
 * launch and a refetch, not their collections — and "Changes aren't being
 * saved" is the wrong sentence for it in the same way it is for the read.
 * {@link PREFERENCE_WRITE_SITES} names them; every other `.setItem` holds
 * something the user typed, bought or synced, so it raises.
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

/** Every failure that is a write rather than a read. */
export function isWriteFailure(scope: StorageFailureSite): boolean {
  return scope.endsWith(".setItem");
}

/**
 * The writes whose failure costs a preference or a refetch, not the user's data.
 *
 * - `i18n-context.setItem` and `locale-helpers.setItem` hold the chosen
 *   language and currency: the next launch opens in the previous one.
 * - `currency-rates.setItem` is a cached FX table with a TTL; a write that
 *   fails means the next conversion fetches again.
 *
 * Every OTHER `.setItem` in {@link STORAGE_FAILURE_SITES} holds something the
 * user typed, bought or synced, which is why the default is to raise: a site
 * added without a decision joins the loud half. `storage-notice.test.ts`
 * requires the decision anyway — the two halves must together cover every
 * write site exactly once.
 */
export const PREFERENCE_WRITE_SITES: readonly StorageFailureSite[] = [
  "i18n-context.setItem",
  "locale-helpers.setItem",
  "currency-rates.setItem",
];

/** The half of {@link StorageFailureSite} that means "the user's data did not land". */
export function losesUserData(scope: StorageFailureSite): boolean {
  return isWriteFailure(scope) && !PREFERENCE_WRITE_SITES.includes(scope);
}

/**
 * Every write site that DOES raise the notice, derived rather than listed.
 *
 * A new entry in {@link STORAGE_FAILURE_SITES} lands here by itself, which is
 * the safe default and also the one a suite can see: the case that pins this
 * list turns red until somebody says which half the new site belongs in.
 */
export const DATA_WRITE_SITES: readonly StorageFailureSite[] =
  STORAGE_FAILURE_SITES.filter(losesUserData);

/**
 * Which sentence a cause gets, and on which platform the user is reading it.
 *
 * ## Why the platform is part of the question
 *
 * `"full"` names ONE error class and two different situations. On a phone the
 * store is the device's disk, the number the user sees is in Settings, and
 * "free up space" is a thing they can go and do. On web the quota is
 * PER-ORIGIN: this site has run out of its slice, the phone's storage screen
 * does not list this app at all, and the sentence written for native sends
 * somebody deleting photos over a limit that has nothing to do with them. Web
 * is also the build this repo actually deploys.
 *
 * The web sentence deliberately does NOT say "clear this site's data", which
 * is the browser's own remedy for a full origin and is the one action that
 * destroys exactly what the toast is warning the user they might lose. Freeing
 * space on the device is the honest half: every engine sizes the origin quota
 * against free disk, so it is both true and safe.
 *
 * Taking the OS as an argument rather than reading `Platform` inside is what
 * lets both branches be asserted: the test harness's `react-native` stub
 * reports `"web"` and cannot report anything else, so a hook that read the
 * module directly would leave the native sentence unreachable from any case.
 */
export function storageNoticeMessageKey(
  reason: StorageFailureReason,
  os: string,
): "storageFullWebMessage" | "storageFullMessage" | "storagePersistRefusedMessage" {
  if (reason !== "full") return "storagePersistRefusedMessage";
  return os === "web" ? "storageFullWebMessage" : "storageFullMessage";
}

/**
 * The one sentence, raised at most once per session whichever half asks.
 *
 * The TITLE is the same either way — "Changes aren't being saved" is what
 * happened, and it is true of both causes — and the message is the half that
 * says what to DO. A full disk does not care that the app was restarted, and a
 * store behind a privacy setting has nothing to delete; a single sentence
 * covering both had to offer the wrong fix to somebody.
 *
 * The gate half passes `"unavailable"` because that is what a refused hydrate
 * means: the store answered with an error when it was READ, before anything
 * was written, so nothing about it says the device is out of space.
 */
function useRaiseStorageNotice(): (reason: StorageFailureReason) => void {
  const toast = useToast();
  const { t } = useI18n();

  return useCallback(
    (reason: StorageFailureReason) => {
      if (noticeShown) return;
      noticeShown = true;
      toast.error(
        t(storageNoticeMessageKey(reason, Platform.OS)),
        t("storagePersistRefusedTitle"),
      );
    },
    [t, toast],
  );
}

/**
 * The gate half. Called by every provider that holds `hydrationSafeToPersist`.
 *
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
 * This hook does NOT subscribe to {@link observeStorageFailures}; that is
 * {@link useStorageFailureNotice}, mounted once. Both raise through the same
 * latch, so a device that fails both ways still says it once.
 */
export function useStorageNotice(gateRefusing: boolean): void {
  const raise = useRaiseStorageNotice();

  useEffect(() => {
    if (!gateRefusing) return;
    raise("unavailable");
  }, [gateRefusing, raise]);
}

/**
 * The write half. ONE subscriber for the whole app — see
 * `components/storage-notice.tsx`, which is the only caller.
 *
 * It needs no argument: a rejected write arrives from
 * {@link observeStorageFailures}, so one that fails in `lib/tombstones.ts` or
 * `lib/sync-cursors.ts` — modules with no React in them at all — reaches the
 * same sentence as one that fails in a provider.
 */
export function useStorageFailureNotice(): void {
  const raise = useRaiseStorageNotice();

  useEffect(
    () =>
      observeStorageFailures((event) => {
        if (losesUserData(event.scope)) raise(event.reason);
      }),
    [raise],
  );
}
