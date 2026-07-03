/**
 * App Store pre-flight config scanner used by `scripts/check-appstore-config.ts`
 * and its tests.
 *
 * Pure module: no filesystem access. The CLI wrapper reads `app.json` from
 * disk (and resolves the icon path) and passes the parsed config here so the
 * checks can be unit-tested under `node --test` without mocking `fs`.
 *
 * Guards the iOS submission block codified from APPSTORE-SUBMISSION.md
 * section 3: a regression that drops `bundleIdentifier`, one of the required
 * `infoPlist` keys, or points `expo.ios.icon` at a missing file would
 * otherwise only surface at `eas submit` time; this catches it locally and in
 * PR CI.
 */

/** The infoPlist keys Apple rejects builds for when missing. */
export const REQUIRED_INFO_PLIST_KEYS = [
  "NSPhotoLibraryUsageDescription",
  "NSCameraUsageDescription",
  "ITSAppUsesNonExemptEncryption",
  "CFBundleLocalizations",
] as const;

export interface AppstoreConfigInput {
  /** The parsed contents of app.json. */
  appJson: unknown;
  /**
   * Whether the `expo.ios.icon` path (repo-relative) resolves on disk.
   * Only consulted when the key is present; the CLI wrapper supplies
   * `fs.existsSync`. The key itself is optional today — the 1024×1024 icon
   * asset is a documented MANUAL step (APPSTORE-SUBMISSION.md section 4) —
   * but a *declared* icon pointing at a missing file is always an error.
   */
  iconExists: (iconPath: string) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the iOS submission block in app.json. Returns a sorted list of
 * human-readable issues; empty means the config is submission-ready (minus
 * the manual asset steps).
 */
export function findAppstoreConfigIssues(input: AppstoreConfigInput): string[] {
  const issues: string[] = [];
  const expo = isRecord(input.appJson)
    ? (input.appJson as Record<string, unknown>).expo
    : undefined;
  if (!isRecord(expo)) {
    return ["app.json must declare a top-level `expo` object"];
  }

  const ios = expo.ios;
  if (!isRecord(ios)) {
    return ["app.json must declare an `expo.ios` object"];
  }

  const bundleId = ios.bundleIdentifier;
  if (typeof bundleId !== "string" || bundleId.trim().length === 0) {
    issues.push("expo.ios.bundleIdentifier must be a non-empty string");
  }

  if (ios.icon !== undefined) {
    if (typeof ios.icon !== "string" || ios.icon.trim().length === 0) {
      issues.push("expo.ios.icon must be a non-empty path when declared");
    } else if (!input.iconExists(ios.icon)) {
      issues.push(
        `expo.ios.icon points at '${ios.icon}' which does not exist on disk`,
      );
    }
  }

  const infoPlist = ios.infoPlist;
  if (!isRecord(infoPlist)) {
    issues.push("expo.ios.infoPlist must be an object");
    return issues.sort();
  }

  for (const key of REQUIRED_INFO_PLIST_KEYS) {
    if (!(key in infoPlist)) {
      issues.push(`expo.ios.infoPlist.${key} is missing`);
    }
  }

  const usageKeys = [
    "NSPhotoLibraryUsageDescription",
    "NSCameraUsageDescription",
  ] as const;
  for (const key of usageKeys) {
    const value = infoPlist[key];
    if (key in infoPlist && (typeof value !== "string" || value.trim() === "")) {
      issues.push(`expo.ios.infoPlist.${key} must be a non-empty string`);
    }
  }

  if (
    "ITSAppUsesNonExemptEncryption" in infoPlist &&
    infoPlist.ITSAppUsesNonExemptEncryption !== false
  ) {
    issues.push(
      "expo.ios.infoPlist.ITSAppUsesNonExemptEncryption must be exactly false",
    );
  }

  const localizations = infoPlist.CFBundleLocalizations;
  if ("CFBundleLocalizations" in infoPlist) {
    if (
      !Array.isArray(localizations) ||
      localizations.length === 0 ||
      localizations.some((l) => typeof l !== "string" || l.trim() === "")
    ) {
      issues.push(
        "expo.ios.infoPlist.CFBundleLocalizations must be a non-empty array of language codes",
      );
    } else if (
      typeof infoPlist.CFBundleDevelopmentRegion === "string" &&
      !localizations.includes(infoPlist.CFBundleDevelopmentRegion)
    ) {
      issues.push(
        "expo.ios.infoPlist.CFBundleLocalizations must include CFBundleDevelopmentRegion",
      );
    }
  }

  return issues.sort();
}

/**
 * Format the issue list as a human-readable error. Returns an empty string
 * when nothing is wrong so callers can short-circuit.
 */
export function formatAppstoreConfigReport(issues: string[]): string {
  if (issues.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `Found ${issues.length} App Store config issue(s) in app.json (see APPSTORE-SUBMISSION.md section 3):`,
  );
  for (const issue of issues) {
    lines.push(`    ${issue}`);
  }
  return lines.join("\n");
}
