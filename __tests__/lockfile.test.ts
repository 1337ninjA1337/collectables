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
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lockedVersions } from "@/lib/lockfile";

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
