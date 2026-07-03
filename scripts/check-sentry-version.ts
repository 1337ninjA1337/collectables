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

import * as fs from "node:fs";
import * as path from "node:path";

import {
  EXPECTED_SENTRY_MAJOR,
  findSentryVersionIssues,
} from "../lib/check-sentry-version";

const REPO_ROOT = path.join(__dirname, "..");

function main(): void {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package-lock.json"), "utf8"),
  );

  const declaredRange = pkg.dependencies?.["@sentry/react-native"];
  const lockedVersion =
    lock.packages?.["node_modules/@sentry/react-native"]?.version;

  const issues = findSentryVersionIssues({ declaredRange, lockedVersion });

  if (issues.length === 0) {
    console.log(
      `check-sentry-version: @sentry/react-native ${lockedVersion} (declared ${declaredRange}) stays on major ${EXPECTED_SENTRY_MAJOR}.`,
    );
    return;
  }

  console.error(
    `Found ${issues.length} Sentry SDK version issue(s):\n` +
      issues.map((i) => `    ${i}`).join("\n"),
  );
  process.exit(1);
}

main();
