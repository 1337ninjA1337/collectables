#!/usr/bin/env tsx
/**
 * Dependency-advisory drift gate: the CLI half.
 *
 * This file is the two things only a process can do — run `npm audit --json`
 * and exit. Every decision is `runAuditGate` in `lib/audit-baseline.ts`: what
 * the gate fails on, the two severity scopes, the soft skip and its annotation,
 * whether npm is asked a second time and what is said about the answer. That
 * module's doc comment is where those are argued, and it is the one that has to
 * be right — five paragraphs restating them here is five paragraphs to keep in
 * step with a file this one no longer contains.
 *
 * The reader used to be here too, on the grounds that it is the process
 * boundary and carries the bound that spawn needs. It carried the bound and it
 * was not where the bound is argued: `AUDIT_TIMEOUT_MS` states the case for
 * three minutes from three measured runs, one module over from four literals
 * typed beside an `execFileSync`. `auditReader` takes the spawn and applies
 * `AUDIT_SPAWN_OPTIONS` itself, so what is left here is the command — and a
 * gate handed a reader with no bound is now a shape that has to be written on
 * purpose rather than one a caller can reach by accident.
 *
 * The command stays spelled out HERE rather than joining the options in `lib/`,
 * and that is a decision rather than an oversight: `verify-gate-script.test.ts`
 * reads each gate leg's own wrapper for a remote call, and moving this one out
 * of sight made the scan report a hermetic `verify` while `npm audit` ran on
 * every leg-run. `AuditSpawn`'s doc comment argues it.
 *
 * Needs the registry, so it is its own CI step rather than a `LINT_GUARDS`
 * entry (that registry is documented as network-free), and a run that cannot
 * reach it is a SOFT SKIP, the same call `check-expo-install` makes:
 * availability of a third party must not decide whether this repo's tests can
 * run.
 */

import { execFileSync } from "node:child_process";

import { auditReader, runAuditGate } from "../lib/audit-baseline";
import { runningUnderActions } from "../lib/github-annotations";

const CHECK_NAME = "check-audit-baseline";

/**
 * The two things only a process can do: read the registry, and exit.
 *
 * Everything between them — which failure a skip was, the annotation that keeps
 * a skip from reading as a checked run, whether to ask npm again, the account of
 * the second read, the under-report warning and the three ways to be red — is
 * {@link runAuditGate}, so it can be run by a test rather than read for. What
 * bounds the read is {@link auditReader}, for the same reason.
 */
function main(): void {
  const run = runAuditGate({
    read: auditReader((options) => execFileSync("npm", ["audit", "--json"], options)),
    checkName: CHECK_NAME,
    underActions: runningUnderActions(),
  });
  for (const line of run.lines) console.log(line);
  if (!run.clean) process.exit(1);
}

main();
