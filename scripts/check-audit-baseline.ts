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
import * as fs from "node:fs";
import * as path from "node:path";

import { auditReader, runAuditGate } from "../lib/audit-baseline";
import { runningUnderActions } from "../lib/github-annotations";
import { lockedVersions } from "../lib/named-fix-direction";

const CHECK_NAME = "check-audit-baseline";
const REPO_ROOT = path.join(__dirname, "..");

/**
 * The installed versions, for the one question the audit report cannot answer
 * about itself: whether the version npm names as a fix is ahead of what is
 * installed.
 *
 * Read here rather than in the module, the same split
 * `scripts/check-sentry-version.ts` uses. An unreadable or unparseable
 * lockfile is `undefined` and the green line simply does not make the claim —
 * a gate that died on a missing lockfile would be a gate that fails for a
 * reason it is not about.
 *
 * ## The parse belongs here, with the read
 *
 * `lockedVersions` runs HERE rather than inside `evaluateAudit`, and the
 * difference is one walk versus two: `runAuditGate` evaluates the report, then
 * `answerWithSecondRead` evaluates a second read of it, and a `lock: unknown`
 * option meant each call re-walked the same 1,265-entry `packages` block for a
 * tree that cannot have changed between them — nothing runs `npm install` in
 * between, only `npm audit --json` is re-read. The two reads share one object
 * now, which also makes "both were placed against the same tree" a fact about
 * the type rather than about this file passing the same argument twice.
 *
 * The `unknown` therefore never leaves this function: it is what
 * `JSON.parse` returns, and the one shape anybody downstream wants out of it
 * is the `name -> version` record.
 */
function readInstalled(): {
  readonly installed?: Readonly<Record<string, string>>;
  readonly note?: string;
} {
  try {
    const lock: unknown = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package-lock.json"), "utf8"),
    );
    return { installed: lockedVersions(lock) };
  } catch (error: unknown) {
    // Named, not swallowed. Two of this gate's failing lists need a direction
    // and a direction needs an installed version, so an unread lockfile makes
    // them empty for the same reason a healthy tree does — and a check that
    // could not ask must not read as a pass. The gate's own floor catches a
    // lockfile that PARSED and answered nothing — an EMPTY record from here,
    // which is a different thing from this `undefined`; this is the half only
    // the process can see.
    return {
      note: `${CHECK_NAME}: package-lock.json could not be read (${error instanceof Error ? error.message : String(error)}), so no fix direction and no namedFix claim was checked on this run.`,
    };
  }
}

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
  const { installed, note } = readInstalled();
  if (note !== undefined) console.log(note);
  const run = runAuditGate({
    read: auditReader((options) => execFileSync("npm", ["audit", "--json"], options)),
    checkName: CHECK_NAME,
    underActions: runningUnderActions(),
    installed,
  });
  for (const line of run.lines) console.log(line);
  if (!run.clean) process.exit(1);
}

main();
