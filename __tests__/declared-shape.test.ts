import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertRequiredMember,
  assertRequiredParameter,
  declaredSource,
  parameterList,
} from "./helpers/declared-shape";
import { suiteCode, suiteFiles } from "./helpers/suite-files";

/**
 * The helper three suites reached for source text to build, tested against the
 * one thing it cannot be given: a signature it should REJECT.
 *
 * Its callers all point it at a real declaration, so every one of them passes
 * and none of them exercises a failure. That is the same gap the console-seam
 * helper was written for one directory over: a checker whose negative half
 * nothing runs is a checker that could be `return true`. The cases below hand
 * it this file's own declarations — required, optional, renamed, retyped,
 * moved — and require the right ones to throw.
 *
 * `FIXTURES` is a real module rather than a string, because `declaredSource`
 * reads the repository and a fixture built in memory would test a different
 * function. This suite is that module: the fixtures below are declarations in
 * this file, which the helper reads back off disk.
 */

// The fixtures. Exported so nothing prunes them, and deliberately dull.
export function fixtureRequired(
  first: string,
  because: string,
  // A default with a CALL in it: the one thing the balanced scan is for, and
  // the shape a first-`)` search ends the parameter list in the middle of.
  trailing = String(1),
): string {
  return `${first}${because}${trailing}`;
}

export function fixtureOptional(because?: string): string {
  return because ?? "";
}

export function fixtureGeneric(
  narrowed: Pick<Console, "log" | "error">,
  other: number,
): number {
  return other + Number(typeof narrowed.log === "function");
}

const FIXTURES = "__tests__/declared-shape.test.ts";

describe("parameterList", () => {
  it("takes the list between balanced parentheses", () => {
    const list = parameterList(declaredSource(FIXTURES), "fixtureRequired");
    assert.ok(list !== null);
    assert.match(list, /because: string/);
    // The list ends at the signature's own closing parenthesis, not at the
    // first `)` after the opening one — which is inside `String(1)`.
    assert.match(list, /trailing = String\(1\)/);
    assert.doesNotMatch(list, /return/);
  });

  it("answers null for a function that is not declared", () => {
    assert.equal(parameterList(declaredSource(FIXTURES), "noSuchThing"), null);
  });
});

describe("assertRequiredParameter", () => {
  it("passes a parameter that is declared, required and correctly typed", () => {
    assert.doesNotThrow(() =>
      assertRequiredParameter({
        module: FIXTURES,
        fn: "fixtureRequired",
        name: "because",
        type: "string",
        at: 1,
        why: "the fixture",
      }),
    );
  });

  it("refuses a parameter that became optional", () => {
    // The half two of the three call sites left implicit. Their regexes did not
    // match `name?: type` and were safe by accident; this is the statement.
    assert.throws(
      () =>
        assertRequiredParameter({
          module: FIXTURES,
          fn: "fixtureOptional",
          name: "because",
          type: "string",
          why: "the fixture",
        }),
      /became optional — the fixture/,
    );
  });

  it("refuses a parameter that was renamed away", () => {
    assert.throws(
      () =>
        assertRequiredParameter({
          module: FIXTURES,
          fn: "fixtureRequired",
          name: "reason",
          type: "string",
          why: "the fixture",
        }),
      /no longer takes reason/,
    );
  });

  it("refuses a parameter that was retyped", () => {
    assert.throws(
      () =>
        assertRequiredParameter({
          module: FIXTURES,
          fn: "fixtureRequired",
          name: "because",
          type: "number",
          why: "the fixture",
        }),
      /is no longer number/,
    );
  });

  it("refuses a parameter that moved, when the position is the rule", () => {
    // `localesDeclaring(declarations, …)` is a rule about what the function is
    // HANDED; a second parameter of the same type would satisfy presence alone.
    assert.throws(
      () =>
        assertRequiredParameter({
          module: FIXTURES,
          fn: "fixtureRequired",
          name: "because",
          type: "string",
          at: 0,
          why: "the fixture",
        }),
      /moved to position 1/,
    );
  });

  it("says so when the function itself is gone, rather than reporting a rename", () => {
    // The failure a caller meets after somebody deletes what they were pinning.
    // "no such parameter" would send them looking at a signature that is not
    // there.
    assert.throws(
      () =>
        assertRequiredParameter({
          module: FIXTURES,
          fn: "noSuchThing",
          name: "because",
          type: "string",
          why: "the fixture",
        }),
      /declares no function noSuchThing/,
    );
  });

  it("splits on top-level commas only, so a generic stays one parameter", () => {
    // `Pick<Console, "log" | "error">` is the type both console seams use, and
    // a naive split on commas makes it three parameters and the next one
    // position 3.
    assert.doesNotThrow(() =>
      assertRequiredParameter({
        module: FIXTURES,
        fn: "fixtureGeneric",
        name: "other",
        type: "number",
        at: 1,
        why: "the fixture",
      }),
    );
  });
});

describe("assertRequiredMember", () => {
  it("passes a required member and refuses an optional one", () => {
    assert.doesNotThrow(() =>
      assertRequiredMember({
        module: "components/danger-icon-button.tsx",
        name: "accessibilityLabel",
        type: "string",
        why: "the shipped rule",
      }),
    );
    assert.throws(
      () =>
        assertRequiredMember({
          module: "components/danger-icon-button.tsx",
          name: "disabled",
          type: "boolean",
          why: "the fixture",
        }),
      /became optional — the fixture/,
    );
  });
});

describe("the suites that pin a signature", () => {
  /**
   * The population, derived: any suite reading a module's text to make a claim
   * about a declaration should be making it through the helper.
   *
   * Written as a floor rather than as a ban, because "this regex is about a
   * signature" is not something a static read can decide — a suite matching
   * `/function foo\(/` might be pinning a call order, which the helper does not
   * do and should not. What the floor says is that the three that produced it
   * still use it: if adoption goes back below three, the helper is on its way
   * to being the thing one suite imports and two have re-implemented.
   */
  it("is used by the three that produced it", () => {
    const adopters = suiteFiles().filter(
      (relative) =>
        relative !== "declared-shape.test.ts" &&
        suiteCode(relative).includes("./helpers/declared-shape"),
    );
    assert.deepEqual(
      adopters.slice().sort(),
      [
        "check-orphan-i18n-keys.test.ts",
        "coverage-floor.test.ts",
        "danger-icon-button.test.ts",
      ],
      "the declared-shape adopters changed — a suite that stopped using it went back to a hand-written regex, and a new one is worth knowing about",
    );
  });
});
