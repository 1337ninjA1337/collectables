import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

import { LINT_GUARDS } from "@/lib/lint-guards";
import { LOCAL_ONLY_MARKER } from "@/lib/local-only";

import { checkNameOf, makePartialRoot, runGuardIn, type PartialRoot } from "./helpers/guard-fixture";
import { SUITES_REL } from "./helpers/suite-files";

/**
 * `check-secrets` skips `.local.` files and now says so. Does it, when it is
 * actually run?
 *
 * The convention itself is unit-tested in `local-only.test.ts` — what cannot
 * be asserted there is the pair of things a reader in front of a red run
 * depends on: that a real credential in a correctly-named copy is passed over
 * AND named in the pass line, and that a credential in a MISNAMED copy is
 * reported with the rule printed underneath it. Both of those live in the
 * wrapper's output, and a wrapper runs `main()` at import, so the only way to
 * ask is to spawn it.
 *
 * The floor shapes the fixtures exactly as it does in
 * `secret-scan-archive-run.test.ts`: the guard refuses below 500 scanned
 * files, so a root it will look at at all is a root that holds them, and
 * `__tests__` + `lib` are 584 between them.
 */

const GUARD = LINT_GUARDS.find((g) => checkNameOf(g.scriptPath) === "check-secrets");

/**
 * An AWS key id, assembled rather than written.
 *
 * A literal here would be a real-shaped secret in a file this scan reads —
 * `__tests__/secret-scan.test.ts` is the one exempt fixture file and this is
 * not it, so the plant has to be built at runtime.
 */
const PLANTED_KEY = `AKIA${"B".repeat(16)}`;
const CREDENTIAL_FILE = `-- pasted connection values\nAwsKey = "${PLANTED_KEY}"\n`;

/** The name the convention covers, and the near-miss a reader actually types. */
const IGNORED = `docs/powerbi/queries${LOCAL_ONLY_MARKER}m`;
const MISNAMED = "docs/powerbi/queries-local.m";

const fixtures = new Map<string, PartialRoot>();
function rootWith(kind: string, files: Record<string, string>): PartialRoot {
  const existing = fixtures.get(kind);
  if (existing) return existing;
  const fixture = makePartialRoot([SUITES_REL, "lib"], files);
  fixtures.set(kind, fixture);
  return fixture;
}
after(() => {
  for (const fixture of fixtures.values()) fixture.cleanup();
});

describe("check-secrets, run against a tree holding a local-only copy", () => {
  it("is a guard this repository registers", () => {
    assert.ok(GUARD, "check-secrets is not in LINT_GUARDS");
  });

  it("passes over a credential in a `.local.` file, and names the file it skipped", () => {
    assert.ok(GUARD);
    const run = runGuardIn(GUARD, rootWith("ignored", { [IGNORED]: CREDENTIAL_FILE }).root);
    assert.equal(run.status, 0, `a \`${LOCAL_ONLY_MARKER}\` file was scanned:\n${run.output}`);
    assert.match(run.output, /no committed secrets/);
    // The half a `filter` used to throw away: a run that skips silently is one
    // where a misnamed copy and a scanned one look identical from outside.
    assert.match(run.output, /skipped 1 local-only file\(s\): docs\/powerbi\/queries\.local\.m/);
  });

  it("reports the same credential in a misnamed copy, and prints the rule under it", () => {
    assert.ok(GUARD);
    const run = runGuardIn(GUARD, rootWith("misnamed", { [MISNAMED]: CREDENTIAL_FILE }).root);
    assert.equal(run.status, 1, `the misnamed copy was not scanned:\n${run.output}`);
    assert.match(run.output, /aws-access-key-id/);
    assert.match(run.output, /queries-local\.m/);
    // The sentence that closes the loop: nothing was skipped, so the reader's
    // file was never covered by the rule they thought they were using.
    assert.match(run.output, /none this run/);
    assert.match(run.output, /Rename it to/);
  });

  it("keeps the two apart in one run: one reported, one skipped and named", () => {
    assert.ok(GUARD);
    const run = runGuardIn(
      GUARD,
      rootWith("both", { [IGNORED]: CREDENTIAL_FILE, [MISNAMED]: CREDENTIAL_FILE }).root,
    );
    assert.equal(run.status, 1, run.output);
    // Exactly one finding, so the skipped copy contributed none — asserting the
    // ignored NAME is absent would prove nothing, since the note names it.
    assert.equal(run.output.match(/aws-access-key-id/g)?.length, 1);
    assert.match(run.output, new RegExp(`this run: ${IGNORED.replace(/[./]/g, "\\$&")}`));
  });
});
