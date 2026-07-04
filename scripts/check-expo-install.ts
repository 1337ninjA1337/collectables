#!/usr/bin/env tsx
/**
 * Fails CI when `npx expo install --check` recommends a different version
 * for one of the watched (posthog-*) packages. Run via
 * `npm run lint:expo-install` (a dedicated CI step on full network).
 *
 * Relationship to the `postinstall` hook: `npx expo install --check ||
 * true` already runs on every install but can never fail — it exists to
 * surface drift to a human. This script is the enforcing half: watched
 * drift exits 1; drift in other (expo-managed) packages is printed as
 * advisory only; and a run that can't reach the Expo registry (the
 * development sandbox, an Expo outage) is a soft skip so availability
 * problems never block CI.
 */

import { spawnSync } from "node:child_process";

import {
  classifyExpoCheck,
  formatExpoInstallReport,
  splitWatchedDrifts,
} from "../lib/check-expo-install";

function main(): void {
  const run = spawnSync("npx", ["expo", "install", "--check"], {
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout: 180_000,
  });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const exitCode = run.status ?? 1;

  const result = classifyExpoCheck(exitCode, output);

  if (result.status === "clean") {
    console.log("check-expo-install: all packages match Expo's recommendations.");
    return;
  }

  if (result.status === "unreachable") {
    console.warn(
      "check-expo-install: `npx expo install --check` failed without drift output (registry unreachable?) — skipping.",
    );
    return;
  }

  const { watched, advisory } = splitWatchedDrifts(result.drifts);

  if (watched.length === 0) {
    console.warn(
      `check-expo-install: ${advisory.length} advisory drift(s) in unwatched package(s) — not blocking:`,
    );
    for (const d of advisory) {
      console.warn(`  ${d.pkg}@${d.installed} -> expected ${d.expected}`);
    }
    return;
  }

  console.error(formatExpoInstallReport(watched, advisory));
  process.exit(1);
}

main();
