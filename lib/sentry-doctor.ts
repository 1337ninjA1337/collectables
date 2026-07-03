/**
 * Sentry wiring self-check used by `scripts/sentry-doctor.ts`
 * (`npm run sentry:check`). Lets an engineer validate the DSN, the latest
 * release tag, and its uploaded sourcemaps without poking the Sentry UI.
 *
 * Pure module with an injectable fetcher (mirrors the `cloudMarkReceived`
 * DI pattern) so every check is node-testable without network access. The
 * CLI wrapper supplies `globalThis.fetch` and prints the report.
 */

import { isValidSentryDsn } from "@/lib/sentry-config";

export type DoctorStatus = "ok" | "fail" | "skip";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorEnv {
  EXPO_PUBLIC_SENTRY_DSN?: string;
  SENTRY_AUTH_TOKEN?: string;
  SENTRY_ORG?: string;
  SENTRY_PROJECT?: string;
}

/** Minimal fetch surface the doctor needs (subset of WHATWG fetch). */
export type DoctorFetcher = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Split a canonical DSN into its ingest host and project id. */
export function parseDsn(
  dsn: string,
): { host: string; projectId: string } | null {
  if (!isValidSentryDsn(dsn)) return null;
  const m = dsn.trim().match(/^https?:\/\/[^@/]+@([^/]+)\/(\d+)$/);
  return m ? { host: m[1], projectId: m[2] } : null;
}

/** The unauthenticated ingest endpoint used for the reachability probe. */
export function envelopeUrl(host: string, projectId: string): string {
  return `https://${host}/api/${projectId}/envelope/`;
}

export function releasesUrl(org: string, project: string): string {
  return `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/releases/?per_page=1`;
}

export function releaseFilesUrl(
  org: string,
  project: string,
  version: string,
): string {
  return `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/releases/${encodeURIComponent(version)}/files/?per_page=1`;
}

/**
 * Run the three checks. Network failures downgrade to `fail` with the error
 * message — the doctor never throws.
 */
export async function runSentryDoctor(
  env: DoctorEnv,
  fetcher: DoctorFetcher,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // 1. DSN present + well-formed + ingest host reachable.
  const dsn = (env.EXPO_PUBLIC_SENTRY_DSN ?? "").trim();
  const parsed = dsn.length > 0 ? parseDsn(dsn) : null;
  if (dsn.length === 0) {
    checks.push({
      name: "dsn",
      status: "skip",
      detail: "EXPO_PUBLIC_SENTRY_DSN not set — crash reporting is disabled",
    });
  } else if (!parsed) {
    checks.push({
      name: "dsn",
      status: "fail",
      detail: "EXPO_PUBLIC_SENTRY_DSN does not match https://<key>@<host>/<projectId>",
    });
  } else {
    try {
      // An empty POST-less GET is rejected by Sentry (405) but proves DNS,
      // TLS, and routing to the project ingest endpoint all work.
      const res = await fetcher(envelopeUrl(parsed.host, parsed.projectId));
      const reachable = res.status > 0 && res.status < 500;
      checks.push({
        name: "dsn",
        status: reachable ? "ok" : "fail",
        detail: reachable
          ? `ingest endpoint reachable (HTTP ${res.status} from ${parsed.host}, project ${parsed.projectId})`
          : `ingest endpoint returned HTTP ${res.status}`,
      });
    } catch (err) {
      checks.push({
        name: "dsn",
        status: "fail",
        detail: `ingest endpoint unreachable: ${String(err)}`,
      });
    }
  }

  // 2 + 3. Latest release tagged, and its sourcemap artifacts present.
  const token = (env.SENTRY_AUTH_TOKEN ?? "").trim();
  const org = (env.SENTRY_ORG ?? "").trim();
  const project = (env.SENTRY_PROJECT ?? "").trim();
  if (!token || !org || !project) {
    const missing = [
      !token && "SENTRY_AUTH_TOKEN",
      !org && "SENTRY_ORG",
      !project && "SENTRY_PROJECT",
    ]
      .filter(Boolean)
      .join(", ");
    const detail = `${missing} not set — release/sourcemap checks need the API`;
    checks.push({ name: "release", status: "skip", detail });
    checks.push({ name: "sourcemaps", status: "skip", detail });
    return checks;
  }

  const headers = { Authorization: `Bearer ${token}` };
  let latestVersion: string | null = null;
  try {
    const res = await fetcher(releasesUrl(org, project), { headers });
    if (!res.ok) {
      checks.push({
        name: "release",
        status: "fail",
        detail: `releases API returned HTTP ${res.status} — check token scope (project:releases) and org/project slugs`,
      });
    } else {
      const releases = (await res.json()) as {
        version?: string;
        dateCreated?: string;
      }[];
      if (!Array.isArray(releases) || releases.length === 0) {
        checks.push({
          name: "release",
          status: "fail",
          detail: "no releases tagged yet — the deploy workflow's sourcemap step may never have run",
        });
      } else {
        latestVersion = releases[0].version ?? null;
        checks.push({
          name: "release",
          status: "ok",
          detail: `latest release ${latestVersion} (created ${releases[0].dateCreated ?? "unknown"})`,
        });
      }
    }
  } catch (err) {
    checks.push({
      name: "release",
      status: "fail",
      detail: `releases API unreachable: ${String(err)}`,
    });
  }

  if (!latestVersion) {
    checks.push({
      name: "sourcemaps",
      status: "skip",
      detail: "no release to inspect",
    });
    return checks;
  }

  try {
    const res = await fetcher(releaseFilesUrl(org, project, latestVersion), {
      headers,
    });
    if (!res.ok) {
      checks.push({
        name: "sourcemaps",
        status: "fail",
        detail: `release files API returned HTTP ${res.status}`,
      });
    } else {
      const files = (await res.json()) as unknown[];
      const has = Array.isArray(files) && files.length > 0;
      checks.push({
        name: "sourcemaps",
        status: has ? "ok" : "fail",
        detail: has
          ? `release ${latestVersion} has uploaded artifacts`
          : `release ${latestVersion} has no uploaded artifacts — stack traces will arrive minified`,
      });
    }
  } catch (err) {
    checks.push({
      name: "sourcemaps",
      status: "fail",
      detail: `release files API unreachable: ${String(err)}`,
    });
  }

  return checks;
}

/** Render the report; `ok` is false when any check failed (skips pass). */
export function formatDoctorReport(checks: DoctorCheck[]): {
  ok: boolean;
  text: string;
} {
  const icon: Record<DoctorStatus, string> = {
    ok: "[ok]  ",
    fail: "[FAIL]",
    skip: "[skip]",
  };
  const text = checks
    .map((c) => `${icon[c.status]} ${c.name}: ${c.detail}`)
    .join("\n");
  return { ok: checks.every((c) => c.status !== "fail"), text };
}
