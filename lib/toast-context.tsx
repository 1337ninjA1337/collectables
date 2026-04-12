import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";

export type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
};

type ToastInput = { type?: ToastType; title?: string; message: string };

type ToastApi = {
  show: (input: ToastInput) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DISPLAY_MS = 3200;

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
      };
      setToasts((current) => [...current, item]);
      setTimeout(() => dismiss(id), DISPLAY_MS);
    },
    [dismiss],
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

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

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
      <Pressable style={styles.body} onPress={onDismiss} accessibilityRole="button">
        {toast.title ? <Text style={[styles.title, { color: palette.text }]}>{toast.title}</Text> : null}
        <Text style={[styles.message, { color: palette.text }]}>{toast.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const PALETTES: Record<ToastType, { bg: string; border: string; accent: string; text: string }> = {
  success: { bg: "#eef7e0", border: "#c5e39a", accent: "#5f9a2f", text: "#2a3b16" },
  error: { bg: "#fbe7e1", border: "#f0b8ac", accent: "#c94a2a", text: "#3d1a11" },
  info: { bg: "#fff4e0", border: "#f0d6a1", accent: "#d89c5b", text: "#2a1d15" },
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
    gap: 8,
  },
  toast: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#1a0e06",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
  accent: {
    width: 5,
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
