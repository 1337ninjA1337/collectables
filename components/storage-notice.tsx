import { useStorageFailureNotice } from "@/lib/storage-notice";

/**
 * The one subscriber that turns a rejected write into a sentence on screen.
 *
 * Renders nothing. It exists because `observeStorageFailures` is a module-level
 * registry — every failing write in the tree already reaches it, from providers
 * and from the React-free modules alike — so the number of listeners it needs
 * is one, and the hook that carries the gate half runs five times.
 *
 * Mounted directly under `ToastProvider` in `app/_layout.tsx`, above the auth
 * gate on purpose: the providers below it unmount around a sign-out and an
 * account switch, and a store that fills up during one of those is exactly the
 * moment the user needs telling. `I18nProvider` sits above `ToastProvider`, so
 * both contexts the hook reads are available here.
 */
export function StorageNotice(): null {
  useStorageFailureNotice();
  return null;
}
