#!/usr/bin/env tsx
/**
 * Fails when the @sentry/react-native version drifts outside the major that
 * `lib/sentry.ts` is written against — Sentry's RN SDK has rewritten its
 * config shape on every major since 5.0. Run via `npm run lint:sentry-version`
 * locally and as part of `lint:ci`.
 *
 * The rules live in `lib/check-sentry-version.ts` so they can be unit-tested
 * under `node --test` without touching the filesystem.
 */

import * as path from "node:path";

import {
  EXPECTED_SENTRY_MAJOR,
  findSentryVersionIssues,
} from "../lib/check-sentry-version";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertParsedInputs } from "../lib/scanned-floor";
import { guardScanRoot, readJsonInput } from "./guard-io";

const CHECK_NAME = "check-sentry-version";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const pkg = readJsonInput(path.join(repoRoot, "package.json"));
  const lock = readJsonInput(path.join(repoRoot, "package-lock.json"));

  assertParsedInputs(CHECK_NAME, {
    "package.json": pkg,
    "package-lock.json": lock,
  });

  const manifest = pkg as {
    dependencies?: Record<string, string | undefined>;
  };
  const lockfile = lock as {
    packages?: Record<string, { version?: string } | undefined>;
  };
  const declaredRange = manifest.dependencies?.["@sentry/react-native"];
  const lockedVersion =
    lockfile.packages?.["node_modules/@sentry/react-native"]?.version;

  const issues = findSentryVersionIssues({ declaredRange, lockedVersion });

  if (issues.length === 0) {
    console.log(
      `${CHECK_NAME}: @sentry/react-native ${lockedVersion} (declared ${declaredRange}) stays on major ${EXPECTED_SENTRY_MAJOR}, read from package.json + package-lock.json.`,
    );
    return;
  }

  console.error(
    `Found ${issues.length} Sentry SDK version issue(s):\n` +
      issues.map((i) => `    ${i}`).join("\n"),
  );
  process.exit(1);
}

try {
  main();
} catch (error) {
  if (error instanceof ScannedFloorError || error instanceof GuardRootError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
