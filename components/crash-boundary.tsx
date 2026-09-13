import type { ComponentType, ReactElement, ReactNode } from "react";
import { ErrorBoundary, wrap } from "@sentry/react-native";

/**
 * The native crash shell: Sentry's own `ErrorBoundary` and `wrap()`, which is
 * exactly what `app/_layout.tsx` had inline before the split.
 *
 * `crash-boundary.web.tsx` is the other half and imports no SDK at all. See
 * that file for the 838 KiB it takes off every web page load, and for what
 * the web build gives up to get it.
 *
 * On native the SDK is not optional in the same way: `wrap()` installs the
 * touch-event breadcrumb boundary and the app-start profiler, both of which
 * are about the platform this file is for, and the bundle it lands in is
 * downloaded once from a store rather than on every visit.
 */

/**
 * What a boundary hands its fallback. A narrower shape than Sentry's
 * `FallbackRender` (which also passes `componentStack` and `eventId`) because
 * it is the shape BOTH halves can honour — the web half has no event id to
 * give, and a contract that only one platform can satisfy is not a contract.
 */
export type CrashFallbackRender = (data: {
  error: unknown;
  resetError: () => void;
}) => ReactElement;

export function CrashBoundary({
  fallback,
  children,
}: {
  fallback: CrashFallbackRender;
  children: ReactNode;
}) {
  return <ErrorBoundary fallback={fallback}>{children}</ErrorBoundary>;
}

/**
 * Wraps the root component in Sentry's instrumentation.
 *
 * A function rather than `export const withCrashReporting = wrap`, so the two
 * halves declare the same signature rather than inheriting two different ones
 * from whatever each platform's implementation happens to be.
 */
export function withCrashReporting<P extends Record<string, unknown>>(
  RootComponent: ComponentType<P>,
): ComponentType<P> {
  return wrap(RootComponent);
}
