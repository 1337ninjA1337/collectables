#!/usr/bin/env tsx
/**
 * Dependency-advisory drift gate: fails when `npm audit` reports a
 * high/critical advisory root that SECURITY.md has not triaged, when npm can
 * clear an advisory AT ANY SEVERITY without a major version change, or when
 * the accepted list names an advisory the audit no longer reports.
 *
 * The two severity scopes are deliberate and different. Needing a triage
 * sentence is expensive, so it is asked at high/critical; needing a lockfile
 * bump costs one command, so it is asked at all five.
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
 *
 * And not merely whether that JSON PARSES. npm reports a registry failure as a
 * JSON error object, which parses and carries no findings, and no findings is
 * what "every accepted advisory has been withdrawn" looks like from in here.
 * `isAuditReport` is the line between the two; see its doc comment for the run
 * that made the case for it.
 */

import { execFileSync } from "node:child_process";

import {
  AUDIT_TIMEOUT_MS,
  auditInvocationSkip,
  auditSkipHeadline,
  evaluateAudit,
  formatAuditVerdict,
  isClean,
  readAuditPayload,
  type AuditRead,
} from "../lib/audit-baseline";
import { annotation, runningUnderActions } from "../lib/github-annotations";

const CHECK_NAME = "check-audit-baseline";

function readAudit(): AuditRead {
  let raw: string;
  try {
    raw = execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      // A registry that never answers used to hold the whole run: three times
      // today, for 5m35s, 7m and past 13m. SIGKILL rather than SIGTERM
      // because what is being given up on is a process waiting on a socket.
      timeout: AUDIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
  } catch (error: unknown) {
    // A findings-present exit still carries the report on stdout; a registry
    // failure carries nothing parseable. The difference is the payload, not
    // the status — EXCEPT when the process was killed, where the payload is
    // whatever had been flushed and means nothing either way.
    const killed = auditInvocationSkip(error, AUDIT_TIMEOUT_MS);
    if (killed !== undefined) return killed;
    const stdout = (error as { stdout?: unknown }).stdout;
    raw = typeof stdout === "string" ? stdout : "";
  }
  // Parsing is not the line, and neither is "something went wrong". npm answers
  // a registry failure with a JSON error object, which parses and carries no
  // findings — and an empty findings set is what "every accepted advisory has
  // been withdrawn" looks like from here. `readAuditPayload` decides and says
  // why in one place.
  return readAuditPayload(raw);
}

function main(): void {
  const read = readAudit();
  if (read.report === undefined) {
    // The headline is who gave up, which the sentence alone does not carry: a
    // run of "we stopped waiting" says the bound may be too tight, a run of
    // "npm reported a failure" says the registry answered and the bound is
    // beside the point. Three skips in a row used to read identically.
    const headline = auditSkipHeadline(read.cause);
    console.log(`${CHECK_NAME}: skipping (${headline}) — ${read.skip}.`);
    // A skip exits 0, so without this a week of registry outages is a week of
    // green runs with the reason in a log nobody opens on a green run. The
    // annotation puts it on the run summary, where the one leg allowed a live
    // feed cannot decline to answer without leaving a mark.
    if (runningUnderActions()) {
      console.log(
        annotation("warning", `${read.skip}. The advisory baseline was NOT checked on this run.`, {
          title: `${CHECK_NAME} skipped: ${headline}`,
        }),
      );
    }
    return;
  }
  const verdict = evaluateAudit(read.report);
  console.log(formatAuditVerdict(verdict, CHECK_NAME));
  // Three ways to be red and `isClean` is the one place that says which, so a
  // finding cannot be printed by a step that exits 0. `stale` joined the
  // failing side with `fixableInRange`, and because of it: fixing an in-range
  // advisory is what MAKES its baseline entry stale, so leaving that half
  // advisory-only would mean every fix this gate now demands leaves the
  // accepted list describing a tree that no longer exists — and green.
  if (!isClean(verdict)) process.exit(1);
}

main();
