/**
 * The toast overlay: the host that stacks them and the view that draws one.
 *
 * Split out of `lib/toast-context.tsx` on 2026-09-14 for a reason that is
 * about the LINT RULES rather than about the code. Five rules in this
 * repository read the app's markup — unnamed icon buttons, unmasked inputs,
 * empty-state wrappers, two heading sweeps — and all five stop at `app/` and
 * `components/`, because `lib/` is where modules return values. That was true
 * of eleven context providers and false of this one: the toast host draws two
 * `<View>`s, two `<Pressable>`s and three `<Text>`s, and it is the surface
 * every error in this app lands on. None of the five had ever looked at it.
 *
 * So the markup moved to where the rules are. What stays in the context is the
 * queue, the api and the provider — values, which is what `lib/` is for.
 *
 * Presentational and stateless about WHICH toasts exist: the list arrives as a
 * prop and dismissal goes back up. The one piece of state here is the
 * dismissal window, and it lives in {@link ToastView} rather than in the
 * provider because a toast the user is reading has to be able to hold its own
 * timer — a countdown owned by the queue cannot be paused by the toast it is
 * counting down.
 */

import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";

import { USE_NATIVE_DRIVER } from "@/lib/animation-driver";
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
import type { ToastItem, ToastType } from "@/lib/toast-context";
import { toastDisplayMs } from "@/lib/toast-timing";

export function ToastHost({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
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
      {/*
        The accent bar rides INSIDE the dismiss target rather than beside it:
        the hold below is wired to this Pressable, and a five-pixel stripe that
        released the timer when the pointer crossed it would be a hover gap
        nobody could see or explain.
      */}
      <Pressable
        style={styles.body}
        onPress={onDismiss}
        onHoverIn={hold}
        onHoverOut={release}
        accessibilityRole="button"
      >
        <View style={[styles.accent, { backgroundColor: palette.accent }]} />
        <View style={styles.bodyText}>
          {toast.title ? <Text style={[styles.title, { color: palette.text }]}>{toast.title}</Text> : null}
          <Text style={[styles.message, { color: palette.text }]}>{toast.message}</Text>
        </View>
      </Pressable>
      {toast.action ? (
        <Pressable
          style={styles.action}
          // Focusable so a keyboard can reach it at all — and so the focus
          // hold above has something to hold ON. react-native-web maps this to
          // a tab stop; on native the toast is not in the focus order and the
          // prop is inert.
          focusable
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
    flexDirection: "row",
  },
  bodyText: {
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
