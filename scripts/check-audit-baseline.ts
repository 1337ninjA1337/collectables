#!/usr/bin/env tsx
/**
 * Dependency-advisory drift gate: fails when `npm audit` reports a
 * high/critical advisory root that SECURITY.md has not triaged.
 *
 * Replaces a bare `npm audit --audit-level=high` that was
 * `continue-on-error: true` and therefore reported the same red for an
 * advisory somebody had read and one nobody had ever seen. Pure logic lives
 * in `lib/audit-baseline.ts`.
 *
 * Needs the npm registry, so it is its own CI step rather than a `LINT_GUARDS`
 * entry (that registry is documented as network-free). A run that cannot reach
 * the registry is a SOFT SKIP, the same call `check-expo-install` makes:
 * availability of a third party must not decide whether this repo's tests can
 * run. `npm audit` exits non-zero WHENEVER it finds anything at or above the
 * default level, so its exit code says nothing here — only its JSON does.
 */

import { execFileSync } from "node:child_process";

import {
  evaluateAudit,
  formatAuditVerdict,
  type AuditReport,
} from "../lib/audit-baseline";

const CHECK_NAME = "check-audit-baseline";

function readAudit(): AuditReport | null {
  let raw: string;
  try {
    raw = execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error: unknown) {
    // A findings-present exit still carries the report on stdout; a registry
    // failure carries nothing parseable. The difference is the payload, not
    // the status.
    const stdout = (error as { stdout?: unknown }).stdout;
    raw = typeof stdout === "string" ? stdout : "";
  }
  if (raw.trim() === "") return null;
  try {
    return JSON.parse(raw) as AuditReport;
  } catch {
    return null;
  }
}

function main(): void {
  const report = readAudit();
  if (report === null) {
    console.log(`${CHECK_NAME}: no parseable audit report (registry unreachable?) — skipping.`);
    return;
  }
  const verdict = evaluateAudit(report);
  console.log(formatAuditVerdict(verdict, CHECK_NAME));
  if (verdict.unexpected.length > 0) process.exit(1);
}

main();
