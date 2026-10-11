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
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lockedVersions, readInstalledVersions } from "@/lib/lockfile";

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
