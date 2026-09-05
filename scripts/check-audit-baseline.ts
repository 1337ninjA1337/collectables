#!/usr/bin/env tsx
/**
 * Dependency-advisory drift gate: the CLI half.
 *
 * This file is the two things only a process can do — run `npm audit --json`
 * and exit — plus the reader that turns one invocation into an `AuditRead`.
 * Every decision is `runAuditGate` in `lib/audit-baseline.ts`: what the gate
 * fails on, the two severity scopes, the soft skip and its annotation, whether
 * npm is asked a second time and what is said about the answer. That module's
 * doc comment is where those are argued, and it is the one that has to be right
 * — five paragraphs restating them here is five paragraphs to keep in step with
 * a file this one no longer contains.
 *
 * The reader is here rather than there because it is the process boundary: it
 * spawns, and it carries the bound that spawn needs. `npm audit` exits non-zero
 * WHENEVER it finds anything at or above the default level, so its exit code
 * says nothing — only its JSON does, and only after `readAuditPayload` has told
 * a report from a registry failure that parses like one.
 *
 * Needs the registry, so it is its own CI step rather than a `LINT_GUARDS`
 * entry (that registry is documented as network-free), and a run that cannot
 * reach it is a SOFT SKIP, the same call `check-expo-install` makes:
 * availability of a third party must not decide whether this repo's tests can
 * run.
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
    read: readAudit,
    checkName: CHECK_NAME,
    underActions: runningUnderActions(),
  });
  for (const line of run.lines) console.log(line);
  if (!run.clean) process.exit(1);
}

main();
