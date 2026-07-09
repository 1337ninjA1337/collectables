/**
 * Single source of truth for the app's data sub-processor disclosures.
 *
 * Every third party that stores or processes user data on our behalf is
 * declared here once — legal name, site, privacy-policy/DPA links, the data
 * types it holds, and its retention window. Three surfaces must never drift
 * from this list:
 *  - the "App Privacy" table (`lib/privacy-manifest.ts` →
 *    APPSTORE-SUBMISSION.md section 6);
 *  - the public PRIVACY.md hosted at `/privacy` (its "Data retention" table
 *    is rendered by `renderRetentionMarkdownTable()` and must contain it
 *    verbatim);
 *  - the future in-app Settings → Privacy disclosure, which should render
 *    directly from `SUB_PROCESSORS`.
 *
 * Pure module: no filesystem access, no React Native imports — node-testable.
 * `__tests__/privacy-disclosure.test.ts` asserts PRIVACY.md names every
 * sub-processor (legal name + privacy/DPA links) and contains the rendered
 * retention table, and that each sub-processor is traceable in the App
 * Privacy manifest, so a hand-edit to any surface fails CI until this module
 * is updated.
 */

export type SubProcessorId =
  | "supabase"
  | "cloudinary"
  | "sentry"
  | "posthog"
  | "clarity";

export interface SubProcessorDisclosure {
  id: SubProcessorId;
  /** Short product name used across code and disclosures ("Sentry"). */
  shortName: string;
  /** Full legal entity ("Functional Software, Inc., d/b/a Sentry"). */
  name: string;
  /** Product/marketing site. */
  url: string;
  /** Public privacy-policy URL. */
  privacyUrl: string;
  /** Data-processing agreement URL, when the vendor publishes one. */
  dpaUrl?: string;
  /** Data types the sub-processor stores or processes for us. */
  dataTypes: readonly string[];
  /** Human-readable retention window for the data it holds. */
  retention: string;
  /**
   * Row in PRIVACY.md's "Data retention" table. Only telemetry
   * sub-processors with a fixed vendor-side window appear there; content
   * stores (Supabase, Cloudinary) are described in prose instead.
   */
  retentionTable?: { surface: string; store: string; window: string };
}

/** Every data sub-processor, in the order PRIVACY.md discloses them. */
export const SUB_PROCESSORS: readonly SubProcessorDisclosure[] = [
  {
    id: "supabase",
    shortName: "Supabase",
    name: "Supabase, Inc.",
    url: "https://supabase.com",
    privacyUrl: "https://supabase.com/privacy",
    dpaUrl: "https://supabase.com/legal/dpa",
    dataTypes: [
      "email address",
      "user identifier",
      "collections",
      "items",
      "marketplace listings",
      "friend connections",
      "chat messages",
    ],
    retention:
      "Until you delete the record or your account; soft-deleted records are purged after a 90-day grace period, server-side analytics events after 13 months (30 days when anonymous).",
  },
  {
    id: "cloudinary",
    shortName: "Cloudinary",
    name: "Cloudinary Ltd.",
    url: "https://cloudinary.com",
    privacyUrl: "https://cloudinary.com/privacy",
    dataTypes: ["item and collection photos"],
    retention: "Until you remove the photo or delete your account.",
  },
  {
    id: "sentry",
    shortName: "Sentry",
    name: "Functional Software, Inc., d/b/a Sentry",
    url: "https://sentry.io",
    privacyUrl: "https://sentry.io/privacy/",
    dpaUrl: "https://sentry.io/legal/dpa/",
    dataTypes: [
      "uncaught exceptions",
      "stack traces",
      "device/OS context",
      "user identifier",
    ],
    retention: "90 days",
    retentionTable: {
      surface: "Crash reports",
      store: "Sentry",
      window: "90 days",
    },
  },
  {
    id: "posthog",
    shortName: "PostHog",
    name: "PostHog, Inc.",
    url: "https://posthog.com",
    privacyUrl: "https://posthog.com/privacy",
    dpaUrl: "https://posthog.com/dpa",
    dataTypes: ["product interaction events", "user identifier"],
    retention:
      "7 days hot storage; longer history lives only in our own database.",
    retentionTable: {
      surface: "Product events",
      store: "PostHog (EU cloud)",
      window:
        "7 days (hot); longer history lives only in our own database, below",
    },
  },
  {
    id: "clarity",
    shortName: "Clarity",
    name: "Microsoft Corporation",
    url: "https://clarity.microsoft.com",
    privacyUrl: "https://privacy.microsoft.com/privacystatement",
    dataTypes: ["anonymous web session replays", "heatmaps"],
    retention: "30 days",
    retentionTable: {
      surface: "Session replays",
      store: "Microsoft Clarity (web only)",
      window: "30 days",
    },
  },
];

/**
 * Render PRIVACY.md's "Data retention" sub-processor table (no trailing
 * newline). PRIVACY.md must contain this output verbatim.
 */
export function renderRetentionMarkdownTable(
  entries: readonly SubProcessorDisclosure[] = SUB_PROCESSORS,
): string {
  const lines = [
    "| Surface | Store | Retention window |",
    "| --- | --- | --- |",
  ];
  for (const e of entries) {
    if (!e.retentionTable) continue;
    const { surface, store, window } = e.retentionTable;
    lines.push(`| ${surface} | ${store} | ${window} |`);
  }
  return lines.join("\n");
}

/**
 * Flatten a disclosure into the plain-text lines an in-app screen (or a
 * plain-text export) can render without re-deriving any copy: name + link
 * line, a data-types line, and a retention line.
 */
export function subProcessorSummaryLines(e: SubProcessorDisclosure): string[] {
  return [
    `${e.shortName} (${e.name}) — ${e.url}`,
    `Data: ${e.dataTypes.join(", ")}`,
    `Retention: ${e.retention}`,
  ];
}
