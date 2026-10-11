/**
 * The one walk over `package-lock.json`, and the two judgement calls in it.
 *
 * This was `lockedVersion(lock, name)` in `lib/named-fix-direction.ts` until
 * 2026-10-09: an exact-key lookup behind four type guards, re-run per
 * candidate per group by four readers, for the one shape any of them wanted.
 * As a lookup, "only the root install" came for free — `node_modules/<name>`
 * either matches or it does not. As a FILTER over every key it is a decision,
 * and these cases are what hold it:
 *
 * - a nested duplicate is not the installed version, because the question is
 *   what a contributor's tree is on and this tree answers it twice;
 * - a scoped name keeps its own slash, so the test cannot be "no slash".
 *
 * The floor at the bottom is the one every scanner here keeps: a reader shown
 * only a fixture has not been shown to read the real file. It asserts a COUNT
 * as well as a version, because a regex over one key passes against a record
 * built from one lucky entry.
 *
 * The second suite is `readInstalledVersions`, the walk's one caller-facing
 * wrapper: the walk cannot tell "no lockfile" from "a lockfile naming
 * nothing", and that distinction is the gate's to draw. It lived in
 * `scripts/check-audit-baseline.ts` as two optional fields and was therefore
 * reachable by no test at all; its own header says what the cases are for.
 *
 * The third is `unwalkableLockfile`, which is the one empty record the walk
 * returns that is a lie rather than an answer: a v1 lockfile named every
 * install under a key this walk does not read. Most of its cases are about
 * what it does NOT report, because the failure mode of a version check is
 * sending a reader after their npm when their tree is simply not installed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  lockedVersions,
  OLDEST_WALKABLE_LOCKFILE_VERSION,
  readInstalledVersions,
  unwalkableLockfile,
} from "@/lib/lockfile";

import { readRepoFile } from "./helpers/repo-file";

describe("lockedVersions", () => {
  const lock = {
    packages: {
      "": { name: "root" },
      "node_modules/expo": { version: "54.0.35" },
      "node_modules/@sentry/react-native": { version: "7.5.0" },
      "node_modules/react-native": { version: "0.81.5" },
      "node_modules/react-native/node_modules/react-native": { version: "0.86.0" },
      "node_modules/broken": { version: 7 },
      "node_modules/empty": { version: "" },
      "node_modules/notanobject": null,
      "not-node-modules/expo": { version: "1.0.0" },
    },
  };

  it("reads every root install in one walk", () => {
    assert.deepEqual(lockedVersions(lock), {
      expo: "54.0.35",
      "@sentry/react-native": "7.5.0",
      "react-native": "0.81.5",
    });
  });

  it("keeps a scoped name's own slash and drops a nested duplicate", () => {
    // This tree really does have react-native twice — 0.81.5 at the root and a
    // nested 0.86.0 that `npm run bundle:native` fails on. Picking one
    // silently is exactly how that would stop being visible, and the scoped
    // key beside it is why the test is "no FURTHER /node_modules/ segment"
    // rather than "no slash".
    const installed = lockedVersions(lock);
    assert.equal(installed["react-native"], "0.81.5");
    assert.equal(installed["@sentry/react-native"], "7.5.0");
    assert.equal(Object.keys(installed).length, 3);
  });

  it("is an empty record for everything it cannot read", () => {
    // Empty rather than thrown, and the callers that need to tell this from
    // "no lockfile at all" do it by whether they were handed one.
    assert.deepEqual(lockedVersions({}), {});
    assert.deepEqual(lockedVersions(null), {});
    assert.deepEqual(lockedVersions("{}"), {});
    assert.deepEqual(lockedVersions({ packages: null }), {});
    assert.deepEqual(lockedVersions(undefined), {});
  });

  it("reads this repository's own lockfile", () => {
    // The floor every scanner here keeps: a reader that only ever saw a
    // fixture has not been shown to read the real shape. And `expo` in
    // particular, because it is the package the finding was about.
    const real: unknown = JSON.parse(readRepoFile("package-lock.json"));
    const installed = lockedVersions(real);
    assert.match(String(installed["expo"]), /^\d+\.\d+\.\d+$/);
    // The one walk has to find MANY of them, or a regex over one key would
    // pass against a record built from a single lucky entry.
    assert.ok(Object.keys(installed).length > 100);
    // And no nested path survived it, on the real tree rather than a fixture.
    for (const name of Object.keys(installed)) assert.ok(!name.includes("/node_modules/"));
  });
});

/**
 * The two states a lockfile read can be in, and the two it used to be able to
 * spell.
 *
 * `scripts/check-audit-baseline.ts` returned `{ installed?, note? }` until
 * 2026-10-11: four states for the two that happen, with `{ installed, note }`
 * and `{}` both constructible and neither meaning anything. The union is the
 * fix; these cases are what hold the two halves apart, and in particular the
 * one boundary that is a DECISION rather than a shape — a lockfile that parsed
 * and named nothing is the `"read"` half, because the gate's own floor is what
 * says so and naming it unreadable would name the wrong cause.
 *
 * The reader takes a thunk, so the unreadable half is exercised by a thunk
 * that throws rather than by planting a broken file on disk. The floor at the
 * bottom reads the real lockfile through the real `node:fs`, which is the only
 * part of this a fixture cannot stand in for.
 */
describe("readInstalledVersions", () => {
  const LOCK = JSON.stringify({
    packages: {
      "node_modules/expo": { version: "54.0.35" },
      "node_modules/react-native": { version: "0.81.5" },
    },
  });

  it("is the read half, carrying the walk's record", () => {
    const read = readInstalledVersions(() => LOCK, "check-x");
    assert.equal(read.kind, "read");
    assert.deepEqual(read.installed, { expo: "54.0.35", "react-native": "0.81.5" });
    // The mirror field, which is what lets the one caller pass
    // `read.installed` onward without narrowing first.
    assert.equal(read.note, undefined);
  });

  it("is the read half for a lockfile that parsed and answered nothing", () => {
    // The one boundary here that is a judgement call. An empty record is an
    // ANSWER — this tree has nothing installed — and the gate's floor is what
    // reports it. Calling it unreadable would blame the file for the tree.
    for (const text of ["{}", '{"packages":null}', '{"lockfileVersion":3}']) {
      const read = readInstalledVersions(() => text, "check-x");
      assert.equal(read.kind, "read", text);
      assert.deepEqual(read.installed, {});
      assert.equal(read.note, undefined);
    }
  });

  it("is the unreadable half when the read throws, and quotes why", () => {
    const read = readInstalledVersions(() => {
      throw new Error("ENOENT: no such file or directory");
    }, "check-audit-baseline");
    assert.equal(read.kind, "unreadable");
    assert.equal(read.installed, undefined);
    // The check's own name on the front, so the line reads as that gate's.
    assert.match(String(read.note), /^check-audit-baseline: package-lock\.json could not be read/);
    // The OS's own words, not a summary of them: a missing file and a
    // permission refusal are different problems with different fixes.
    assert.match(String(read.note), /ENOENT: no such file or directory/);
    // And the consequence, because an unread lockfile empties two of the
    // gate's lists for the same reason a healthy tree does.
    assert.match(String(read.note), /no fix direction and no namedFix claim was checked/);
  });

  it("is the unreadable half when the text is not JSON", () => {
    // One `catch` for both failures on purpose: a file that is not there and
    // a file that is not JSON are the same answer to the same question.
    const read = readInstalledVersions(() => "not json at all", "check-x");
    assert.equal(read.kind, "unreadable");
    assert.equal(read.installed, undefined);
    assert.match(String(read.note), /^check-x: package-lock\.json could not be read \(/);
  });

  it("carries a non-Error throw through as a string", () => {
    const read = readInstalledVersions(() => {
      throw "plain string";
    }, "check-x");
    assert.equal(read.kind, "unreadable");
    assert.match(String(read.note), /\(plain string\)/);
  });

  it("reads this repository's own lockfile through node:fs", () => {
    // The floor: everything above is a thunk, and a reader shown only thunks
    // has not been shown to read the file the gate actually reads.
    const read = readInstalledVersions(() => readRepoFile("package-lock.json"), "check-x");
    assert.equal(read.kind, "read");
    assert.ok(Object.keys(read.installed ?? {}).length > 100);
    assert.match(String(read.installed?.["expo"]), /^\d+\.\d+\.\d+$/);
  });
});

/**
 * The version question, asked beside the walk rather than inside it.
 *
 * `lockedVersions` returns `{}` for a v1 lockfile, for `null`, for a string
 * and for a tree with nothing installed. Three of those four are answers the
 * audit gate's floor reports truthfully. The v1 one is not: the file named
 * every install under `dependencies`, the walk read `packages`, and the
 * sentence that comes out blames the tree for the reader's npm.
 *
 * The cases below are the boundary, and most of them are about what is NOT
 * reported — an empty object and a bare `lockfileVersion: 3` are a lockfile
 * that named nothing, and a reader told "this looks like v1" about those has
 * been sent the wrong way.
 */
describe("unwalkableLockfile", () => {
  it("names a stated v1 and what to do about it", () => {
    const why = unwalkableLockfile({ lockfileVersion: 1, dependencies: { expo: {} } });
    assert.match(String(why), /^lockfileVersion 1,/);
    // The version this check needs, from the constant rather than a literal.
    assert.match(String(why), new RegExp(`from version ${String(OLDEST_WALKABLE_LOCKFILE_VERSION)} on`));
    // And the one action that fixes it, because that is the whole point of
    // separating this from "the lockfile answered for none of them".
    assert.match(String(why), /run `npm install` with a current npm/);
  });

  it("names the v1 LAYOUT when the field is missing or mistyped", () => {
    // The field is not load-bearing on its own: the layout is what the walk
    // fails on, so a nested `dependencies` with no `packages` is the same
    // file with the field lost.
    for (const lock of [
      { dependencies: { expo: { version: "1.0.0" } } },
      { lockfileVersion: "1", dependencies: {} },
    ]) {
      const why = unwalkableLockfile(lock);
      assert.match(String(why), /^no `packages` block and a nested `dependencies` one/);
    }
  });

  it("is silent for every lockfile the walk can actually read", () => {
    // v2 and v3 both key installs under `packages`, and a `dependencies`
    // block BESIDE one is npm's v2 back-compatibility copy, not a v1 file.
    assert.equal(unwalkableLockfile({ lockfileVersion: 3, packages: {} }), undefined);
    assert.equal(unwalkableLockfile({ lockfileVersion: 2, packages: {}, dependencies: {} }), undefined);
    assert.equal(unwalkableLockfile({ packages: { "node_modules/expo": { version: "1.0.0" } } }), undefined);
  });

  it("is silent for a lockfile that simply named nothing", () => {
    // The distinction this function exists to draw, from the other side. None
    // of these claims to be v1, and the gate's floor is the right reporter
    // for all of them.
    for (const lock of [{}, { lockfileVersion: 3 }, { packages: null }, null, "{}", undefined, 7]) {
      assert.equal(unwalkableLockfile(lock), undefined, JSON.stringify(lock) ?? "undefined");
    }
  });

  it("is silent on this repository's own lockfile", () => {
    // The floor: this file is lockfileVersion 3 and the gate must not start
    // reporting it as unreadable.
    const real: unknown = JSON.parse(readRepoFile("package-lock.json"));
    assert.equal(unwalkableLockfile(real), undefined);
    assert.equal((real as { lockfileVersion?: unknown }).lockfileVersion, 3);
  });

  it("is the unreadable half of a read, with the shared consequence clause", () => {
    // The two unreadable causes end in one sentence, written once: a reader
    // who sees only the cause does not know the run was weaker than a green
    // one.
    const read = readInstalledVersions(
      () => JSON.stringify({ lockfileVersion: 1, dependencies: {} }),
      "check-audit-baseline",
    );
    assert.equal(read.kind, "unreadable");
    assert.equal(read.installed, undefined);
    assert.match(String(read.note), /^check-audit-baseline: package-lock\.json is lockfileVersion 1,/);
    assert.match(String(read.note), /so no fix direction and no namedFix claim was checked on this run\.$/);
  });
});
