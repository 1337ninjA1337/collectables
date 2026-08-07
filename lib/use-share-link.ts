import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Share } from "react-native";

import { COPIED_RESET_MS, buildSharePayload } from "@/lib/share-link-helpers";

export { COPIED_RESET_MS, buildSharePayload };

/**
 * Whether a clipboard write is even possible on this platform.
 *
 * `navigator.clipboard` is web-only, so on iOS/Android there is no writer at
 * all today — callers must not render a copy affordance there (the pre-hook
 * share sheets did, and pressing it silently did nothing). A native path is
 * blocked on adding `expo-clipboard`; see .tasks/.suggestions.md.
 */
export const CAN_COPY_TO_CLIPBOARD = Platform.OS === "web";

export type ShareLink = {
  /** True for `COPIED_RESET_MS` after a successful clipboard write. */
  copied: boolean;
  /** False on native — do not render a copy affordance when this is false. */
  canCopy: boolean;
  copyLink: () => void;
  shareNative: () => void;
};

/**
 * The share-a-deep-link ceremony every share surface repeats: the native
 * `Share.share()` invocation, the clipboard write, the `copied` flag and its
 * reset timer — including the `clearTimeout` on unmount that each inline copy
 * of this logic used to leak.
 *
 * `<ShareSheet>` is the first consumer; anything that shares a link WITHOUT
 * opening the sheet (a header long-press, a toast action, a QR screen) can use
 * the hook directly instead of re-implementing the state machine.
 */
export function useShareLink(
  url: string,
  options?: { message?: string; onCopy?: (url: string) => void },
): ShareLink {
  const message = options?.message;
  const onCopy = options?.onCopy;
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copyLink = useCallback(() => {
    if (!CAN_COPY_TO_CLIPBOARD || !navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      onCopy?.(url);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    });
  }, [onCopy, url]);

  const shareNative = useCallback(() => {
    Share.share(buildSharePayload(url, message));
  }, [message, url]);

  return { copied, canCopy: CAN_COPY_TO_CLIPBOARD, copyLink, shareNative };
}
