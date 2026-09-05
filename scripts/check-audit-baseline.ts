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
 *
 * That line catches a registry that fails LOUDLY. One that fails quietly — a
 * well-formed report whose findings are simply missing — gets through it, and
 * did, on 2026-09-04. `reportCompleteness` is the second line: it checks the
 * report's entries against the report's own totals and withholds the staleness
 * half of the verdict when they disagree, rather than failing the run over
 * advisories npm did not mention.
 *
 * And the third line is asking again. Both of the above turn a wrong answer
 * into a withheld one, which is better and is still not an answer; this is the
 * only leg of `verify` whose answer can change while the tree does not, and
 * `answerWithSecondRead` is what lets it check rather than leaving that to
 * whoever re-runs the step by hand. Spent only where it can change the outcome —
 * see `worthAsking` — so a healthy run costs exactly what it did.
 *
 * What is left in this file is the two things only a process can do: run
 * `npm audit` and exit. The decisions are `runAuditGate`, which takes this
 * file's reader and returns the lines to print, so a test can run them.
 */

import { execFileSync } from "node:child_process";

import {
  AUDIT_TIMEOUT_MS,
  auditInvocationSkip,
  readAuditPayload,
  runAuditGate,
  type AuditRead,
} from "../lib/audit-baseline";
import { runningUnderActions } from "../lib/github-annotations";

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

/**
 * The two things only a process can do: read the registry, and exit.
 *
 * Everything between them — which failure a skip was, the annotation that keeps
 * a skip from reading as a checked run, whether to ask npm again, the account of
 * the second read, the under-report warning and the three ways to be red — is
 * {@link runAuditGate}, so it can be run by a test rather than read for.
 */
function main(): void {
  const run = runAuditGate({
    read: readAudit(),
    readAgain: readAudit,
    checkName: CHECK_NAME,
    underActions: runningUnderActions(),
  });
  for (const line of run.lines) console.log(line);
  if (!run.clean) process.exit(1);
}

main();
