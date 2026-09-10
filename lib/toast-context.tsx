import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import {
  AMBER_ACCENT,
  AMBER_SOFT_3,
  CARD_BG_15,
  DANGER_DEEP_7,
  DANGER_DEEP_8,
  DANGER_SOFT_6,
  DANGER_SOFT_7,
  HERO_DARK_2,
  HERO_DARK_9,
  SPACING_INLINE,
  SUCCESS_DEEP,
  SUCCESS_GREEN_3,
  SUCCESS_SOFT,
  SUCCESS_SOFT_2,
} from "@/lib/design-tokens";
import { USE_NATIVE_DRIVER } from "@/lib/animation-driver";
import { toastDisplayMs } from "@/lib/toast-timing";

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

type ToastItem = {
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
      setToasts((current) => [...current, item]);
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

function ToastHost({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={styles.host}>
      <View pointerEvents="box-none" style={styles.stack}>
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
        ))}
      </View>
    </View>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const anim = useRef(new Animated.Value(0)).current;
  // The handler changes identity on every render of the host (it closes over
  // the id), and the timer must not restart because of that — so the effect
  // depends on the ref, and the ref is what the timeout reads.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const [held, setHeld] = useState(false);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [anim]);

  /**
   * The dismissal window, held open while the user is engaged with the toast.
   *
   * A pointer over it or focus inside it both mean "I am still reading this",
   * and an undo that expires under the cursor reaching for it is the failure
   * this prevents. Leaving restarts the FULL window rather than resuming the
   * remainder: the user has just looked away from something they were reading,
   * and a 300ms stub would be indistinguishable from a toast that ignored them.
   */
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => dismissRef.current(), toastDisplayMs(!!toast.action));
    return () => clearTimeout(timer);
  }, [held, toast.action]);

  const hold = () => setHeld(true);
  const release = () => setHeld(false);

  const palette = PALETTES[toast.type];
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });

  return (
    <Animated.View
      style={[
        styles.toast,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: anim, transform: [{ translateY }] },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: palette.accent }]} />
      <Pressable
        style={styles.body}
        onPress={onDismiss}
        onHoverIn={hold}
        onHoverOut={release}
        accessibilityRole="button"
      >
        {toast.title ? <Text style={[styles.title, { color: palette.text }]}>{toast.title}</Text> : null}
        <Text style={[styles.message, { color: palette.text }]}>{toast.message}</Text>
      </Pressable>
      {toast.action ? (
        <Pressable
          style={styles.action}
          onHoverIn={hold}
          onHoverOut={release}
          onFocus={hold}
          onBlur={release}
          onPress={() => {
            // The action first, then the dismissal: a handler that threw would
            // otherwise leave the toast up with its button already spent.
            toast.action?.onPress();
            onDismiss();
          }}
          accessibilityRole="button"
          accessibilityLabel={toast.action.label}
        >
          <Text style={[styles.actionText, { color: palette.text }]}>{toast.action.label}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const PALETTES: Record<ToastType, { bg: string; border: string; accent: string; text: string }> = {
  success: {
    bg: SUCCESS_SOFT_2,
    border: SUCCESS_SOFT,
    accent: SUCCESS_GREEN_3,
    text: SUCCESS_DEEP,
  },
  error: {
    bg: DANGER_SOFT_6,
    border: DANGER_SOFT_7,
    accent: DANGER_DEEP_7,
    text: DANGER_DEEP_8,
  },
  info: {
    bg: CARD_BG_15,
    border: AMBER_SOFT_3,
    accent: AMBER_ACCENT,
    text: HERO_DARK_2,
  },
};

const TOP_INSET =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) + 8 : Platform.OS === "web" ? 16 : 48;

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: TOP_INSET,
  },
  stack: {
    width: "100%",
    maxWidth: 520,
    gap: SPACING_INLINE,
  },
  toast: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: HERO_DARK_9,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
  accent: {
    width: 5,
  },
  action: {
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  body: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
  },
});
