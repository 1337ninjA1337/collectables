/**
 * Single source of truth for the app's privacy declarations.
 *
 * Emits both artefacts that must stay in sync:
 *  - the "App Privacy" Markdown table embedded in APPSTORE-SUBMISSION.md
 *    (section 6), via `renderPrivacyMarkdownTable()`;
 *  - the Apple `PrivacyInfo.xcprivacy` property list required since iOS 17,
 *    via `renderPrivacyInfoPlist()` (written to disk by
 *    `scripts/generate-privacy-manifest.ts`).
 *
 * Pure module: no filesystem access, no React Native imports — node-testable.
 * `__tests__/privacy-manifest.test.ts` asserts the guide contains the rendered
 * table verbatim and the committed plist matches the rendered plist, so a
 * hand-edit to either artefact fails CI until this module is updated.
 */

/** Apple NSPrivacyCollectedDataType identifiers used by this app. */
export type ApplePrivacyDataType =
  | "NSPrivacyCollectedDataTypeEmailAddress"
  | "NSPrivacyCollectedDataTypeUserID"
  | "NSPrivacyCollectedDataTypePhotosorVideos"
  | "NSPrivacyCollectedDataTypeName"
  | "NSPrivacyCollectedDataTypeOtherUserContent"
  | "NSPrivacyCollectedDataTypeCrashData"
  | "NSPrivacyCollectedDataTypeProductInteraction"
  | "NSPrivacyCollectedDataTypeOtherUsageData";

export type ApplePrivacyPurpose =
  | "NSPrivacyCollectedDataTypePurposeAppFunctionality"
  | "NSPrivacyCollectedDataTypePurposeAnalytics";

export interface PrivacyDataEntry {
  /** Human-readable data type, first column of the Markdown table. */
  dataType: string;
  /** "Collected?" column, e.g. `**Yes**`, `**No**`, `**No (in app)**`. */
  collected: string;
  /** "Linked to user?" column: `Yes`, `No`, or `—` when not collected. */
  linkedToUser: string;
  /** "Used for tracking?" column: `No`, or `—` when not collected. */
  usedForTracking: string;
  /** "Source" column: where in the code the data flows. */
  source: string;
  /**
   * Apple plist declaration for collected data. Absent when the row is a
   * "not collected" clarification (BI tooling, IDFA) — those appear in the
   * human-facing table but have no `NSPrivacyCollectedDataTypes` entry.
   */
  apple?: {
    type: ApplePrivacyDataType;
    linked: boolean;
    tracking: boolean;
    purposes: ApplePrivacyPurpose[];
  };
}

const APP_FUNCTIONALITY: ApplePrivacyPurpose =
  "NSPrivacyCollectedDataTypePurposeAppFunctionality";
const ANALYTICS: ApplePrivacyPurpose =
  "NSPrivacyCollectedDataTypePurposeAnalytics";

/** The declarations backing APPSTORE-SUBMISSION.md section 6. */
export const PRIVACY_MANIFEST: readonly PrivacyDataEntry[] = [
  {
    dataType: "Email address",
    collected: "**Yes**",
    linkedToUser: "Yes",
    usedForTracking: "No",
    source: "Supabase Auth (`lib/auth-context.tsx`)",
    apple: {
      type: "NSPrivacyCollectedDataTypeEmailAddress",
      linked: true,
      tracking: false,
      purposes: [APP_FUNCTIONALITY],
    },
  },
  {
    dataType: "User ID (Supabase UUID)",
    collected: "**Yes**",
    linkedToUser: "Yes",
    usedForTracking: "No",
    source: "Supabase Auth",
    apple: {
      type: "NSPrivacyCollectedDataTypeUserID",
      linked: true,
      tracking: false,
      purposes: [APP_FUNCTIONALITY],
    },
  },
  {
    dataType: "Photos",
    collected: "**Yes**",
    linkedToUser: "Yes",
    usedForTracking: "No",
    source: "Cloudinary uploads (`lib/cloudinary.ts`)",
    apple: {
      type: "NSPrivacyCollectedDataTypePhotosorVideos",
      linked: true,
      tracking: false,
      purposes: [APP_FUNCTIONALITY],
    },
  },
  {
    dataType: "Username / display name",
    collected: "**Yes**",
    linkedToUser: "Yes",
    usedForTracking: "No",
    source: "`UserProfile`",
    apple: {
      type: "NSPrivacyCollectedDataTypeName",
      linked: true,
      tracking: false,
      purposes: [APP_FUNCTIONALITY],
    },
  },
  {
    dataType: "Chat messages",
    collected: "**Yes**",
    linkedToUser: "Yes",
    usedForTracking: "No",
    source: "Supabase realtime (`lib/supabase-chat.ts`)",
    apple: {
      type: "NSPrivacyCollectedDataTypeOtherUserContent",
      linked: true,
      tracking: false,
      purposes: [APP_FUNCTIONALITY],
    },
  },
  {
    dataType: "Crash data / diagnostics",
    collected: "**Yes**",
    linkedToUser: "Yes",
    usedForTracking: "No",
    source:
      "Sentry (`@sentry/react-native`, `lib/sentry.ts`); the user's Supabase UUID is attached so we can correlate crashes per account. PII (email, IP, cookies, Authorization header) is stripped before send by `scrubPII` (`lib/sentry.ts`).",
    apple: {
      type: "NSPrivacyCollectedDataTypeCrashData",
      linked: true,
      tracking: false,
      purposes: [APP_FUNCTIONALITY],
    },
  },
  {
    dataType: "Product analytics events",
    collected: "**Yes**",
    linkedToUser: "Yes",
    usedForTracking: "No",
    source:
      "PostHog (`posthog-react-native`, `lib/analytics.ts`); a closed set of interaction events (`signup_completed`, `item_added`, …). Events are linked to the Supabase UUID via `identifyUser`. EU host (`eu.posthog.com`) by default. Diagnostics-toggle gated; rate-limited to 200/min/user.",
    apple: {
      type: "NSPrivacyCollectedDataTypeProductInteraction",
      linked: true,
      tracking: false,
      purposes: [ANALYTICS],
    },
  },
  {
    dataType: "Session replay / heatmaps",
    collected: "**Yes**",
    linkedToUser: "No",
    usedForTracking: "No",
    source:
      'Microsoft Clarity (web-only, runtime `<script>` tag, `lib/clarity.ts`); anonymous interaction recordings, not linked to the user ID. Loads only when `navigator.doNotTrack !== "1"` **and** the diagnostics toggle is on.',
    apple: {
      type: "NSPrivacyCollectedDataTypeOtherUsageData",
      linked: false,
      tracking: false,
      purposes: [ANALYTICS],
    },
  },
  {
    dataType: "Reporting / BI",
    collected: "**No (in app)**",
    linkedToUser: "—",
    usedForTracking: "—",
    source:
      "Power BI Desktop (`docs/powerbi/`); no SDK ships in the app. It is an operator-side tool that connects directly to the Supabase Postgres `analytics_events` table — no additional data is collected from the device.",
  },
  {
    dataType: "Advertising ID (IDFA)",
    collected: "**No**",
    linkedToUser: "—",
    usedForTracking: "—",
    source: "No ads SDK present.",
  },
];

/**
 * Apple "required reason API" declarations. AsyncStorage is backed by
 * NSUserDefaults on iOS; CA92.1 = "access user defaults to read and write
 * information only accessible to the app itself".
 */
export const ACCESSED_API_TYPES: readonly {
  type: string;
  reasons: string[];
}[] = [
  {
    type: "NSPrivacyAccessedAPICategoryUserDefaults",
    reasons: ["CA92.1"],
  },
];

/** Render the guide's "App Privacy" Markdown table (no trailing newline). */
export function renderPrivacyMarkdownTable(
  entries: readonly PrivacyDataEntry[] = PRIVACY_MANIFEST,
): string {
  const lines = [
    "| Data type | Collected? | Linked to user? | Used for tracking? | Source |",
    "| --------- | ---------- | --------------- | ------------------ | ------ |",
  ];
  for (const e of entries) {
    lines.push(
      `| ${e.dataType} | ${e.collected} | ${e.linkedToUser} | ${e.usedForTracking} | ${e.source} |`,
    );
  }
  return lines.join("\n");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render the iOS `PrivacyInfo.xcprivacy` property list. Only entries with an
 * `apple` declaration appear; the app performs no tracking, so
 * `NSPrivacyTracking` is false and the tracking-domain list is empty.
 */
export function renderPrivacyInfoPlist(
  entries: readonly PrivacyDataEntry[] = PRIVACY_MANIFEST,
  accessedApiTypes: readonly { type: string; reasons: string[] }[] = ACCESSED_API_TYPES,
): string {
  const collected = entries.flatMap((e) => (e.apple ? [e.apple] : []));
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>NSPrivacyTracking</key>",
    "\t<false/>",
    "\t<key>NSPrivacyTrackingDomains</key>",
    "\t<array/>",
    "\t<key>NSPrivacyCollectedDataTypes</key>",
    "\t<array>",
  ];
  for (const apple of collected) {
    lines.push("\t\t<dict>");
    lines.push("\t\t\t<key>NSPrivacyCollectedDataType</key>");
    lines.push(`\t\t\t<string>${xmlEscape(apple.type)}</string>`);
    lines.push("\t\t\t<key>NSPrivacyCollectedDataTypeLinked</key>");
    lines.push(apple.linked ? "\t\t\t<true/>" : "\t\t\t<false/>");
    lines.push("\t\t\t<key>NSPrivacyCollectedDataTypeTracking</key>");
    lines.push(apple.tracking ? "\t\t\t<true/>" : "\t\t\t<false/>");
    lines.push("\t\t\t<key>NSPrivacyCollectedDataTypePurposes</key>");
    lines.push("\t\t\t<array>");
    for (const purpose of apple.purposes) {
      lines.push(`\t\t\t\t<string>${xmlEscape(purpose)}</string>`);
    }
    lines.push("\t\t\t</array>");
    lines.push("\t\t</dict>");
  }
  lines.push("\t</array>");
  lines.push("\t<key>NSPrivacyAccessedAPITypes</key>");
  lines.push("\t<array>");
  for (const api of accessedApiTypes) {
    lines.push("\t\t<dict>");
    lines.push("\t\t\t<key>NSPrivacyAccessedAPIType</key>");
    lines.push(`\t\t\t<string>${xmlEscape(api.type)}</string>`);
    lines.push("\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>");
    lines.push("\t\t\t<array>");
    for (const reason of api.reasons) {
      lines.push(`\t\t\t\t<string>${xmlEscape(reason)}</string>`);
    }
    lines.push("\t\t\t</array>");
    lines.push("\t\t</dict>");
  }
  lines.push("\t</array>");
  lines.push("</dict>");
  lines.push("</plist>");
  return lines.join("\n") + "\n";
}
