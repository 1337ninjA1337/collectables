/**
 * Expo-recommended-version drift checker used by
 * `scripts/check-expo-install.ts` and its tests.
 *
 * Pure module: no child_process, no filesystem, no React Native imports —
 * the CLI wrapper runs `npx expo install --check` and hands the captured
 * output here so the parser/classifier can be unit-tested under
 * `node --test` without a network or an Expo project.
 *
 * Why this exists (.tasks/.tasks.md line 176): the `posthog-js` /
 * `posthog-react-native` versions were pinned manually because the
 * development sandbox cannot reach the Expo registry. The existing
 * `postinstall` hook (`npx expo install --check || true`) surfaces drift
 * locally but never fails. This module powers a CI step on full network
 * that DOES fail when Expo's registry recommends a different version for
 * one of the watched (posthog-*) packages — before the drift lands in
 * TestFlight. Drift in other packages stays advisory: Expo SDK bumps
 * routinely re-recommend a dozen of its own packages and that churn should
 * not block unrelated PRs.
 */

/** Package-name prefixes whose drift fails the check (vs. advisory). */
export const WATCHED_PACKAGE_PREFIXES = ["posthog-"] as const;

export type ExpoDrift = {
  /** Package name, e.g. "posthog-react-native" or "@sentry/react-native". */
  pkg: string;
  /** Version currently installed per expo's output. */
  installed: string;
  /** Version expo recommends for the current SDK. */
  expected: string;
};

export type ExpoCheckStatus =
  /** expo exited 0 — everything matches the SDK's recommendations. */
  | "clean"
  /** expo exited non-zero and printed parseable drift lines. */
  | "drift"
  /**
   * expo exited non-zero without parseable drift — registry unreachable
   * (sandbox/offline) or the CLI failed some other way. The CLI wrapper
   * treats this as a soft skip so an Expo outage can't block CI.
   */
  | "unreachable";

export type ExpoCheckResult = {
  status: ExpoCheckStatus;
  drifts: ExpoDrift[];
};

/**
 * Matches expo's drift lines, e.g.
 * `  posthog-react-native@4.44.4 - expected version: 4.47.0`
 * (scoped packages like `@sentry/react-native@7.2.0` included).
 */
const DRIFT_LINE_PATTERN =
  /^\s*(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)@(\S+)\s+-\s+expected version:\s+(\S+)\s*$/i;

/** Parse `expo install --check` output into drift entries (order kept). */
export function parseExpoInstallDrifts(output: string): ExpoDrift[] {
  const drifts: ExpoDrift[] = [];
  for (const line of output.split("\n")) {
    const m = DRIFT_LINE_PATTERN.exec(line);
    if (m) {
      drifts.push({ pkg: m[1], installed: m[2], expected: m[3] });
    }
  }
  return drifts;
}

/**
 * Classify a finished `expo install --check` run. Exit 0 always means
 * clean; a non-zero exit only counts as drift when the output carries
 * parseable drift lines — anything else (network failure, npx bootstrap
 * error) is "unreachable" so the caller can skip instead of hard-failing.
 */
export function classifyExpoCheck(exitCode: number, output: string): ExpoCheckResult {
  if (exitCode === 0) {
    return { status: "clean", drifts: [] };
  }
  const drifts = parseExpoInstallDrifts(output);
  if (drifts.length > 0) {
    return { status: "drift", drifts };
  }
  return { status: "unreachable", drifts: [] };
}

/** True when the package is one whose drift must fail the check. */
export function isWatchedPackage(
  pkg: string,
  prefixes: readonly string[] = WATCHED_PACKAGE_PREFIXES,
): boolean {
  return prefixes.some((prefix) => pkg.startsWith(prefix));
}

/** Split drift entries into blocking (watched) and advisory (the rest). */
export function splitWatchedDrifts(
  drifts: ExpoDrift[],
  prefixes: readonly string[] = WATCHED_PACKAGE_PREFIXES,
): { watched: ExpoDrift[]; advisory: ExpoDrift[] } {
  const watched: ExpoDrift[] = [];
  const advisory: ExpoDrift[] = [];
  for (const d of drifts) {
    (isWatchedPackage(d.pkg, prefixes) ? watched : advisory).push(d);
  }
  return { watched, advisory };
}

/**
 * Format the failure report for watched drift (empty string when there is
 * none, so callers can short-circuit). Advisory drift is appended as an
 * FYI block when present.
 */
export function formatExpoInstallReport(
  watched: ExpoDrift[],
  advisory: ExpoDrift[] = [],
): string {
  if (watched.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `Expo recommends different version(s) for ${watched.length} watched package(s):`,
  );
  for (const d of watched) {
    lines.push(`  ${d.pkg}@${d.installed} -> expected ${d.expected}`);
  }
  lines.push(
    "Update the pinned version(s) via `npx expo install <pkg>` (see docs/analytics-platform.md) so the drift never reaches TestFlight.",
  );
  if (advisory.length > 0) {
    lines.push("");
    lines.push(`Advisory (non-blocking) drift in ${advisory.length} other package(s):`);
    for (const d of advisory) {
      lines.push(`  ${d.pkg}@${d.installed} -> expected ${d.expected}`);
    }
  }
  return lines.join("\n");
}
