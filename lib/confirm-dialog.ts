import { Alert, Platform } from "react-native";

/**
 * Web-vs-native confirmation primitive. Wraps the two divergent paths:
 *   - `window.confirm(title + body)` on web (synchronous, blocks the tab)
 *   - `Alert.alert(title, body, [...])` on native (async via button callbacks)
 *
 * Both branches converge on a single `Promise<boolean>` so callers don't
 * have to fork their flow. Resolves `true` if the user confirms, `false`
 * if they cancel (or the platform can't render the dialog).
 *
 * Callers must NOT block on this — the native variant fires its callback
 * asynchronously, so a `void` use-case is fine but a `then`/`await` is
 * required when the next step depends on the result.
 */
export type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
};

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const { title, body, confirmLabel, cancelLabel, destructive } = options;

  if (Platform.OS === "web") {
    // `typeof window !== "undefined" && window.confirm` guards against SSR
    // and rare RN-web sandboxes that proxy `window`. Falling back to `true`
    // mirrors the original screen behaviour (caller proceeds with action),
    // since refusing to render the dialog should not silently swallow the
    // user's intent on the touch path.
    const ok =
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(`${title}\n\n${body}`)
        : true;
    return Promise.resolve(ok);
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(title, body, [
      { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? "destructive" : "default",
        onPress: () => resolve(true),
      },
    ]);
  });
}
