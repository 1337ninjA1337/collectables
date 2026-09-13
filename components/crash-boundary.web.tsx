import { Component, type ComponentType, type ReactElement, type ReactNode } from "react";

import { captureException } from "@/lib/sentry";

/**
 * The web crash shell, which imports no SDK — and it is the second largest
 * saving anybody has found in this bundle.
 *
 * ## 838 KiB, measured
 *
 * `app/_layout.tsx` imported `@sentry/react-native` twice at module scope, for
 * `Sentry.wrap()` and `<ErrorBoundary>`, and an import is a dependency whatever
 * the component does with it. `lib/sentry.ts` has always loaded the SDK through
 * a lazy `import()` — with a comment about dev/test bundles never paying for it
 * at startup — and the root layout handed the whole thing to every page load
 * anyway: `@sentry/core` 293 KiB, `@sentry/react-native` 195, `@sentry-internal/replay`
 * 124, `@sentry/browser` 90, `@sentry-internal/feedback` 49, plus browser-utils,
 * `@sentry/react` and replay-canvas. Replay and feedback are features nothing
 * in this app calls; they were in the bundle because the root imported their
 * parent.
 *
 * The lazy loader now has nothing racing it on web, so the SDK arrives in a
 * chunk of its own when `DiagnosticsProvider` initialises it — after the stored
 * opt-in has been hydrated, which is the order `lib/sentry.ts` was written for.
 *
 * ## What the web build gives up, honestly
 *
 * `Sentry.wrap()`'s touch-event breadcrumbs and app-start profiler: neither is
 * mounted here any more. The error boundary itself is NOT given up — this class
 * is one, and it reports through `captureException` in `@/lib/sentry`, which
 * adds the rate limit, the opt-out check and `scrubPII` that the SDK's own
 * boundary bypasses.
 *
 * **A crash before the SDK finishes loading is not reported, and was not before
 * either.** `captureException` returns early while `sdk` is null, and Sentry's
 * own boundary would have called a client that `initSentry` had not created
 * yet. What changes is the length of that window — a lazy chunk fetch rather
 * than a module already in memory — and what it buys is that every page load
 * stops paying for a boundary that only matters after init.
 *
 * ## Why this is not a `Platform.OS` branch
 *
 * A conditional would still import the module, and the import is the cost. The
 * split has to be at the FILE level, the same reason `gesture-root.web.tsx` is
 * a file — and `check-platform-pairs` keeps the two halves' exports in step.
 */

export type CrashFallbackRender = (data: {
  error: unknown;
  resetError: () => void;
}) => ReactElement;

type CrashBoundaryProps = {
  fallback: CrashFallbackRender;
  children: ReactNode;
};

type CrashBoundaryState = {
  /** The thrown value, or null while the subtree is healthy. */
  error: unknown;
  /** True only after something was caught — `error` may legitimately be null. */
  crashed: boolean;
};

/**
 * A React error boundary has to be a class: `getDerivedStateFromError` and
 * `componentDidCatch` have no hook equivalent, which is the whole reason
 * `@sentry/react` ships one.
 */
export class CrashBoundary extends Component<CrashBoundaryProps, CrashBoundaryState> {
  state: CrashBoundaryState = { error: null, crashed: false };

  /**
   * `crashed` rather than `error !== null`, because `throw null` and
   * `throw undefined` are legal and would otherwise render the broken subtree
   * again, throw again, and loop.
   */
  static getDerivedStateFromError(error: unknown): CrashBoundaryState {
    return { error, crashed: true };
  }

  componentDidCatch(error: unknown): void {
    // Through `@/lib/sentry` rather than a direct SDK call: that module owns
    // the opt-out check, the rate limit and the PII scrub, and it is the only
    // path on web that does not drag the SDK into the entry chunk.
    //
    // NO `extra`, and the component stack React hands this method is what is
    // being given up. `analytics-pii.test.ts` rules that an `extra` carries
    // the app's own vocabulary — `keyspace`, `reason` — because `scrubPII`
    // never reads it, and a React component stack is assembled text rather
    // than a label. It would also be thin: this bundle is minified, so the
    // names in it are the minifier's. The exception and its stack still go,
    // and Sentry symbolicates those from the uploaded sourcemaps.
    captureException(error, { scope: "crash-boundary" });
  }

  resetError = (): void => {
    this.setState({ error: null, crashed: false });
  };

  render(): ReactNode {
    if (this.state.crashed) {
      return this.props.fallback({ error: this.state.error, resetError: this.resetError });
    }
    return this.props.children;
  }
}

/**
 * Identity on web: `Sentry.wrap()`'s touch breadcrumbs and start-up profiler
 * are native instrumentation, and wrapping the root in them here would import
 * the SDK — which is the entire thing this file exists to avoid.
 */
export function withCrashReporting<P extends Record<string, unknown>>(
  RootComponent: ComponentType<P>,
): ComponentType<P> {
  return RootComponent;
}
