import assert from "node:assert/strict";

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
 */

/** What a spy `captureException` pushes: the error and the context beside it. */
export type CapturedReport = { error: unknown; context: unknown };

/** Everything `reportStorageFailure` puts in one event. */
export type ExpectedStorageReport = {
  scope: string;
  keyspace: string;
  /** The classification the user's toast was chosen from. */
  reason: "full" | "unavailable";
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
