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
 * `answer()` is what lets it check rather than leaving that to whoever re-runs
 * the step by hand. Spent only where it can change the outcome — see
 * `worthAsking` — so a healthy run costs exactly what it did.
 */

import { execFileSync } from "node:child_process";

import {
  AUDIT_TIMEOUT_MS,
  auditInvocationSkip,
  auditSkipHeadline,
  evaluateAudit,
  formatAuditVerdict,
  formatSecondRead,
  isClean,
  readAuditPayload,
  reconcileAudit,
  secondReadAgreed,
  worthAsking,
  type AuditRead,
  type AuditVerdict,
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

/**
 * The verdict to act on, asking npm a second time when the first answer was
 * about what it did NOT say.
 *
 * This is the only leg of `verify` that can answer differently for one commit,
 * and until now it was also the only one that could not check. On 2026-09-04 a
 * degraded registry produced two red runs claiming the whole baseline had been
 * withdrawn, and a human re-running the step by hand is what established
 * otherwise — twice, nine minutes apart, for the cost of one call each time.
 *
 * The second call is spent only where it can change the answer: see
 * {@link worthAsking}, which is a stale-only red or a report short of its own
 * totals. A healthy run never reaches it, so the gate's cost on the runs that
 * pass is unchanged; a degraded one pays about 49 seconds for the difference
 * between a red CI and a green one.
 *
 * What the second read DID is printed, by {@link formatSecondRead}. Announcing
 * the call and then printing a verdict leaves a reader unable to tell whether
 * the second read landed, agreed, or was the one that changed the answer — and
 * the reconciled verdict carries the completeness of whichever read decided, so
 * a first read short of its own totals otherwise vanishes from a run that met a
 * degraded registry and said so nowhere.
 */
function answer(first: AuditVerdict): AuditVerdict {
  if (!worthAsking(first)) return first;
  console.log(
    `${CHECK_NAME}: this answer rests on what npm did NOT report, so asking once more before acting on it.`,
  );
  const again = readAudit();
  if (again.report === undefined) {
    // The registry stopped answering between the two calls. That says nothing
    // about the first answer either way, so the first answer stands — and it
    // is printed with the same withholding it always had.
    console.log(`${CHECK_NAME}: the second read did not land (${again.skip}); reporting the first.`);
    return first;
  }
  const second = evaluateAudit(again.report);
  // The one line the log was missing: it announced a second call and then
  // printed a verdict, so a reader could not tell whether the second read
  // landed, agreed, or was the one that changed the answer.
  const account = formatSecondRead(first, second, CHECK_NAME);
  console.log(account);
  // And a mark on the run summary when they DISAGREED. npm answering one commit
  // two ways inside one run is the fact the reconciliation is built to hide —
  // it prints one answer, correctly — and it is also the only evidence a
  // contributor gets that the registry was degraded while their branch was
  // being judged. A notice, not a warning: the run's answer is sound.
  if (!secondReadAgreed(first, second) && runningUnderActions()) {
    console.log(
      annotation(
        "notice",
        `npm answered this tree two different ways in one run. ${account} Findings from either read are kept; a baseline entry is pruned only where both reads agree it is gone.`,
        { title: `${CHECK_NAME}: the two reads of the registry disagreed` },
      ),
    );
  }
  return reconcileAudit(first, second);
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
  const verdict = answer(evaluateAudit(read.report));
  console.log(formatAuditVerdict(verdict, CHECK_NAME));
  // A withheld staleness check is a half-answered run, and the half it did not
  // answer exits 0. The same argument the skip's annotation makes: without a
  // mark on the run summary, "we could not ask" is only ever visible in a log
  // nobody opens on a green run.
  if (verdict.completeness.underReported.length > 0 && runningUnderActions()) {
    const withheld = verdict.completeness.complete
      ? "Baseline staleness was still checked — the shortfall is below the severities it reads."
      : `Baseline staleness was NOT checked: ${String(verdict.completeness.claimed)} high/critical roots counted, ${String(verdict.completeness.carried)} reported.`;
    console.log(
      annotation(
        "warning",
        `npm counted more roots than it reported, at ${verdict.completeness.underReported
          .map((row) => `${row.severity} (${String(row.carried)} of ${String(row.claimed)})`)
          .join(", ")}. ${withheld}`,
        { title: `${CHECK_NAME}: npm's report was short of its own totals` },
      ),
    );
  }
  // Three ways to be red and `isClean` is the one place that says which, so a
  // finding cannot be printed by a step that exits 0. `stale` joined the
  // failing side with `fixableInRange`, and because of it: fixing an in-range
  // advisory is what MAKES its baseline entry stale, so leaving that half
  // advisory-only would mean every fix this gate now demands leaves the
  // accepted list describing a tree that no longer exists — and green.
  if (!isClean(verdict)) process.exit(1);
}

main();
