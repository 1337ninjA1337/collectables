import assert from "node:assert/strict";

import type { CaptureContext } from "../../lib/sentry";
import type { StorageFailureReason } from "../../lib/report-storage-failure";

/**
 * The one assertion every suite that spies on `captureException` was writing
 * out by hand, and the reason it must stay strict.
 *
 * `reportStorageFailure` sends Sentry a `scope` and an `extra` holding the
 * KEYSPACE (never the key — every per-user builder ends in the account's auth
 * id, and `scrubPII` reads event bodies rather than the `extra` a caller
 * assembles) and the REASON the notice classified the error as. Four cases in
 * two suites asserted that object with `deepEqual`, which is right: a fifth
 * field added silently is exactly what a whole-object comparison catches, and a
 * `.keyspace` lookup would let one through. What it also did was make every new
 * field a four-site edit, and the pressure that puts on the next contributor is
 * to loosen the assertion rather than to update it.
 *
 * So the strictness lives here once. A new field in the report is still one
 * red case per suite — the shape below stops compiling and the message says
 * what to do — but the comparison itself is written in one place.
 *
 * ## Both types are IMPORTED, not restated
 *
 * `reason` was a hand-written `"full" | "unavailable"` union and `context` was
 * `unknown`, because a helper that pulled `lib/` in at module scope would
 * evaluate the very modules its suites mock. `import type` is erased before the
 * runner sees it — nothing is loaded — so the union and the context shape are
 * now the app's own. A third reason, or a fourth field on `CaptureContext`,
 * reaches these suites through the compiler instead of leaving them checking a
 * copy of what the app used to do.
 */

/**
 * What a spy `captureException` pushes: the error and the context beside it.
 *
 * The context is the app's {@link CaptureContext} rather than `unknown`, so a
 * case that only cares WHICH write broke can read `report.context.scope`
 * without restating the shape — which is what three suites were doing.
 */
export type CapturedReport = { error: unknown; context: CaptureContext };

/** Everything `reportStorageFailure` puts in one event. */
export type ExpectedStorageReport = {
  scope: string;
  keyspace: string;
  /** The classification the user's toast was chosen from. */
  reason: StorageFailureReason;
};

/**
 * Asserts one captured report EXACTLY — scope, keyspace and reason, with no
 * other field anywhere in the context.
 *
 * @param index which report to read, for the cases that provoke several.
 */
export function expectStorageReport(
  captured: readonly CapturedReport[],
  expected: ExpectedStorageReport,
  index = 0,
): void {
  const report = captured[index];
  assert.ok(
    report,
    `no storage failure was reported at index ${index} — ${captured.length} in total`,
  );
  assert.deepEqual(
    report.context,
    { scope: expected.scope, extra: { keyspace: expected.keyspace, reason: expected.reason } },
    "the whole context, not a field of it: a report that grew a field is a decision somebody should see",
  );
}
