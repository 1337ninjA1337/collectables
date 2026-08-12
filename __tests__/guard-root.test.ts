/**
 * The scan-root resolver: which directory a guard walks, and which env var
 * moved it there.
 *
 * `__tests__/lint-guard-empty-root.test.ts` uses the override for real — this
 * file pins the decision itself, including the two cases that never appear in
 * a green run: a relative override (three different roots depending on who
 * spawned the guard) and a blank one (`FOO= npm run lint:all`, which is how an
 * override gets un-set).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";

import {
  GUARD_ROOT_ENV,
  GuardRootError,
  PRIVACY_BASELINE_ROOT_ENV,
  formatGuardRootNotice,
  resolveGuardRoot,
} from "../lib/guard-root";

const DEFAULT_ROOT = "/repo";
const CHECK = "check-example";

const resolve = (
  env: Record<string, string | undefined>,
  vars?: readonly string[],
) => resolveGuardRoot(CHECK, DEFAULT_ROOT, env, vars);

describe("resolveGuardRoot", () => {
  it("returns the default root, and no source, when nothing is set", () => {
    assert.deepEqual(resolve({}), { root: DEFAULT_ROOT, source: null });
  });

  it("honours an absolute override and names the variable that supplied it", () => {
    assert.deepEqual(resolve({ [GUARD_ROOT_ENV]: "/tmp/empty" }), {
      root: path.normalize("/tmp/empty"),
      source: GUARD_ROOT_ENV,
    });
  });

  it("treats an empty or whitespace-only value as unset", () => {
    // `LINT_GUARD_REPO_ROOT= npm run lint:all` is how the override is turned
    // off; reading it as "" would point every guard at the process cwd.
    for (const blank of ["", "   ", "\t\n"]) {
      assert.deepEqual(resolve({ [GUARD_ROOT_ENV]: blank }), {
        root: DEFAULT_ROOT,
        source: null,
      });
    }
  });

  it("trims and normalises the path it was handed", () => {
    const resolution = resolve({ [GUARD_ROOT_ENV]: "  /tmp/a/../empty/  " });
    assert.equal(resolution.root, path.normalize("/tmp/empty"));
  });

  it("refuses a relative override rather than resolving it against cwd", () => {
    // The same string would name three different trees depending on whether
    // it came from `npm run`, from lint:all, or from a test spawn.
    assert.throws(
      () => resolve({ [GUARD_ROOT_ENV]: "../elsewhere" }),
      (error: unknown) =>
        error instanceof GuardRootError &&
        error.checkName === CHECK &&
        /is not an absolute path/.test(error.message),
    );
  });

  it("prefixes the refusal with the guard's own name, like every other guard failure", () => {
    assert.throws(
      () => resolve({ [GUARD_ROOT_ENV]: "rel" }),
      // assert.throws matches against `String(error)`, which prefixes the name.
      new RegExp(`GuardRootError: ${CHECK}: ERROR — `),
    );
  });

  it("takes the first variable that carries a value, in the order given", () => {
    const env = {
      [PRIVACY_BASELINE_ROOT_ENV]: "/tmp/history",
      [GUARD_ROOT_ENV]: "/tmp/fleet",
    };
    const vars = [PRIVACY_BASELINE_ROOT_ENV, GUARD_ROOT_ENV];
    assert.equal(resolve(env, vars).source, PRIVACY_BASELINE_ROOT_ENV);
    assert.equal(resolve(env, vars).root, path.normalize("/tmp/history"));
  });

  it("falls through to the next variable when the first is unset", () => {
    const resolution = resolve(
      { [GUARD_ROOT_ENV]: "/tmp/fleet" },
      [PRIVACY_BASELINE_ROOT_ENV, GUARD_ROOT_ENV],
    );
    assert.equal(resolution.source, GUARD_ROOT_ENV);
  });

  it("ignores the shared variable for a guard that does not declare it", () => {
    // The default list is one entry; a guard opts into more by naming them.
    const resolution = resolve({ SOMETHING_ELSE: "/tmp/x" });
    assert.equal(resolution.source, null);
  });
});

describe("formatGuardRootNotice", () => {
  it("says nothing on the ordinary path", () => {
    assert.equal(formatGuardRootNotice(CHECK, resolve({})), null);
  });

  it("names the guard, the variable and the root when redirected", () => {
    const notice = formatGuardRootNotice(
      CHECK,
      resolve({ [GUARD_ROOT_ENV]: "/tmp/empty" }),
    );
    assert.ok(notice);
    assert.match(notice, new RegExp(`^${CHECK}: NOTE — `));
    assert.match(notice, new RegExp(GUARD_ROOT_ENV));
    assert.match(notice, /\/tmp\/empty/);
    // The point of the line: a green run from a redirected root has to be
    // distinguishable from a green run over this repository.
    assert.match(notice, /says nothing about the repository/);
  });
});
