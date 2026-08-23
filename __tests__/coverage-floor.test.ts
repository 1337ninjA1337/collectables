import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/strip-comments";

import { arguedFloor, measuredFloor } from "./helpers/coverage-floor";
import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

/**
 * The two floor kinds, and why they needed names.
 *
 * A sweep that walks the tree and finds nothing reports clean, which is the one
 * failure a structural case cannot survive. `assert.ok(found.length >= N)` is
 * the guard, and there are ninety-odd of them here. The number means one of two
 * things — the count today, or a coverage claim someone argued for — and the two
 * are indistinguishable written out, so a reader meeting a failing one cannot
 * tell whether to update it or investigate.
 *
 * The messages are what carry the distinction now. These cases pin the words a
 * reader acts on, and one of them asks whether the family this started in is
 * still using them.
 */

describe("measuredFloor", () => {
  it("says the number is the count, so a failure means the pattern stopped matching", () => {
    const message = measuredFloor(2, 5, "module(s) matched");
    assert.match(message, /only 2 module\(s\) matched/);
    assert.match(message, /MEASURED/);
    assert.match(message, /the pattern stopped matching/);
  });

  it("does not tell the reader the tree fell below a target, which it did not", () => {
    // The wrong reading is the expensive one: a measured floor going red is a
    // broken walk, and "raise the number" is the fix that hides it forever.
    assert.doesNotMatch(measuredFloor(2, 5, "things"), /ARGUED/);
  });
});

describe("arguedFloor", () => {
  it("carries the reason the number was chosen", () => {
    const message = arguedFloor(
      5,
      6,
      "module(s) name the language constants",
      "no fewer than the six the hand-written list this replaced covered",
    );
    assert.match(message, /only 5 module\(s\) name the language constants/);
    assert.match(message, /ARGUED: no fewer than the six/);
    assert.match(message, /below the current count on purpose/);
  });

  it("frames a count that fell TO the floor as a real loss, not a stale number", () => {
    // The whole point of arguing a floor below the count: growth needs no edit,
    // and arrival at the floor is a finding rather than bookkeeping.
    assert.match(
      arguedFloor(6, 6, "things", "because"),
      /a real loss of coverage rather than a number needing an update/,
    );
  });

  it("requires the reason, which is the difference between the two", () => {
    // A measured floor's reason is that it is the count. An argued one has no
    // such default, and a number chosen rather than observed is exactly the one
    // that reads as arbitrary later — so the parameter is required rather than
    // optional. Asserted from the signature, since a missing argument is a
    // compile error rather than anything a case can call.
    const helper = stripComments(readRepoFile("__tests__/helpers/coverage-floor.ts"));
    assert.match(
      helper,
      /export function arguedFloor\([^)]*because: string,?\s*\)/,
      "arguedFloor's reason is no longer a required parameter — an argued floor with no argument is a measured floor that has not admitted it",
    );
  });
});

describe("the family the distinction was written for", () => {
  it("states a kind at every floor it has", () => {
    // The three sweeps that produced this helper. If one of them goes back to a
    // hand-written message, the distinction is prose again in that file and the
    // helper is on its way to being unused.
    const SWEEPS = [
      "__tests__/provenance-key-set.test.ts",
      "__tests__/provenance-report.test.ts",
      "__tests__/privacy-translated-section.test.ts",
    ];
    const silent = SWEEPS.filter((suite) => {
      const source = stripComments(readRepoFile(suite));
      return !/(measured|argued)Floor\(/.test(source);
    });
    assert.deepEqual(
      silent,
      [],
      `these sweeps floor a walk without saying which kind of floor it is: ${silent.join(", ")}`,
    );
  });

  it("is the only place the helper lives, so it is a test concern", () => {
    // It reasons about how cases are written. A lib/ module importing it would
    // mean a floor had reached production, which is a different thing wearing
    // the same word.
    const offenders = sourceFiles("lib", "scripts", "app", "components").filter(
      (file) => stripComments(readRepoFile(file)).includes("coverage-floor"),
    );
    assert.deepEqual(
      offenders,
      [],
      `these production modules reach for a test helper: ${offenders.join(", ")}`,
    );
  });
});
