#!/usr/bin/env tsx
/**
 * Prints whether the Sentry wiring is healthy: DSN reachable, latest release
 * tagged, and sourcemaps uploaded for it. Run via `npm run sentry:check`.
 *
 * Reads EXPO_PUBLIC_SENTRY_DSN / SENTRY_AUTH_TOKEN / SENTRY_ORG /
 * SENTRY_PROJECT from the environment (source your `.env` first, or export
 * them). Checks whose inputs are missing are skipped, not failed, so the
 * script is safe to run in any environment. Exits 1 only on a hard failure.
 *
 * The checks live in `lib/sentry-doctor.ts` (injectable fetcher) so they are
 * unit-tested without network access; this wrapper supplies real `fetch`.
 */

import { formatDoctorReport, runSentryDoctor } from "../lib/sentry-doctor";

async function main(): Promise<void> {
  const checks = await runSentryDoctor(
    {
      EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
      SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
      SENTRY_ORG: process.env.SENTRY_ORG,
      SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    },
    (url, init) => fetch(url, init),
  );
  const { ok, text } = formatDoctorReport(checks);
  console.log("sentry-doctor:");
  console.log(text);
  if (!ok) process.exit(1);
}

void main();
