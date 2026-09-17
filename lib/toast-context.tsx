import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

import { ToastHost } from "@/components/toast-host";
import { announceMessage } from "@/lib/announce";
import { toastAnnouncement } from "@/lib/toast-announcement";
import { capToastStack } from "@/lib/toast-stack";

export type ToastType = "success" | "error" | "info";

/**
 * A second thing the toast can do, beyond being read and dismissed.
 *
 * `onPress` runs and the toast closes — an action that left it standing would
 * invite a second press on an undo that has already happened. The label is
 * a translated string, not a key: this module is below the i18n context and
 * every other string it renders arrives the same way.
 */
export type ToastAction = { label: string; onPress: () => void };

/**
 * One queued toast.
 *
 * Exported since the overlay moved to `components/toast-host.tsx`: the queue
 * lives here and the drawing lives there, so the shape they pass between them
 * has to be nameable from both. A TYPE-only export, so the import in the host
 * is erased and the two files do not form a runtime cycle.
 */
export type ToastItem = {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
  action?: ToastAction;
};

type ToastInput = { type?: ToastType; title?: string; message: string; action?: ToastAction };

type ToastApi = {
  show: (input: ToastInput) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = ++nextId.current;
      const item: ToastItem = {
        id,
        type: input.type ?? "info",
        title: input.title,
        message: input.message,
        action: input.action,
      };
      // Capped rather than appended: a loop that toasts per failure would
      // otherwise stack an overlay down the whole screen, every entry of it at
      // `zIndex: 9999` over the app. The oldest goes — see lib/toast-stack.ts.
      setToasts((current) => capToastStack([...current, item]));
      // Said as well as shown, from here rather than from each caller: the host
      // is an overlay a screen reader reaches only if it walks into it, and by
      // then the toast may be gone. `announceMessage` writes the app's one
      // live region, so this does not compete with the reorder announcements.
      const spoken = toastAnnouncement(item);
      if (spoken) announceMessage(spoken);
      // The dismissal timer lives in <ToastView>, not here: a toast the user is
      // reading (hovering, or with the action focused) has to be able to HOLD
      // its window, and a timer owned by the provider cannot be paused by the
      // toast it is counting down. See lib/toast-timing.ts for the window.
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, title) => show({ type: "success", message, title }),
      error: (message, title) => show({ type: "error", message, title }),
      info: (message, title) => show({ type: "info", message, title }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
