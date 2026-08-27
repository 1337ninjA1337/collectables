import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertRequiredMember,
  assertRequiredParameter,
  declarationBody,
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

// A comma and a closing parenthesis, each inside a string literal where it
// means nothing to either depth counter. Without quote-awareness the list ends
// in the middle of `closing` and `"a,b"` splits into two parameters.
export function fixtureQuoted(
  separator: "a,b",
  closing: ")",
  trailing: number,
): string {
  return `${separator}${closing}${String(trailing)}`;
}

// An overload set: three `function fixtureOverloaded(` in one module, of which
// the first is a signature no caller of this helper meant.
export function fixtureOverloaded(value: string): string;
export function fixtureOverloaded(value: number): string;
export function fixtureOverloaded(value: string | number): string {
  return String(value);
}

// The shape the splitter says it does not read: `=> void` closes a bracket
// nothing opened, and the old counter went to -1 and carried on.
export function fixtureCallback(
  onDone: (value: string) => void,
  after: number,
): number {
  onDone("");
  return after;
}

// Two types, one member name, opposite rules. The pair a module-wide read
// answers from whichever came first.
export type FixtureAlpha = {
  readonly shared: string;
};

export type FixtureBeta = {
  readonly shared?: number;
};

// Interface merging is legal TypeScript, so "declared twice" is a real module
// this could be pointed at rather than a hypothetical.
export interface FixtureMerged {
  readonly first: string;
}

export interface FixtureMerged {
  readonly second: number;
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

  it("reads past a closing parenthesis that is inside a string literal", () => {
    // The balanced scan and the `String(1)` case above agree on parentheses
    // that MEAN something. This one does not: `closing: ")"` is a type, and a
    // counter that decrements on it ends the list one parameter in.
    const list = parameterList(declaredSource(FIXTURES), "fixtureQuoted");
    assert.ok(list !== null);
    assert.match(list, /trailing: number/);
  });

  it("refuses a name the module declares more than once", () => {
    // An overload set. The first signature is `(value: string)`, the
    // implementation's is `(value: string | number)`, and a first-hit read
    // answers about the one nobody asked for.
    assert.throws(
      () => parameterList(declaredSource(FIXTURES), "fixtureOverloaded"),
      /fixtureOverloaded is declared 3 times/,
    );
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

  it("does not split on a comma that is inside a string-literal type", () => {
    // `separator: "a,b"` is one parameter. Split naively it is two, and
    // `trailing` is position 3 rather than 2.
    assert.doesNotThrow(() =>
      assertRequiredParameter({
        module: FIXTURES,
        fn: "fixtureQuoted",
        name: "trailing",
        type: "number",
        at: 2,
        why: "the fixture",
      }),
    );
  });

  it("refuses a signature whose brackets it cannot balance", () => {
    // `(value: string) => void` closes a `>` nothing opened. The old counter
    // went negative and kept splitting; a wrong answer here is a case that
    // passes while asserting nothing.
    assert.throws(
      () =>
        assertRequiredParameter({
          module: FIXTURES,
          fn: "fixtureCallback",
          name: "after",
          type: "number",
          at: 1,
          why: "the fixture",
        }),
      /cannot read the parameter list .* out of scope/s,
    );
  });
});

describe("declarationBody", () => {
  it("takes one type's members and not its neighbour's", () => {
    const alpha = declarationBody(declaredSource(FIXTURES), "FixtureAlpha");
    assert.ok(alpha !== null);
    assert.match(alpha, /readonly shared: string;/);
    assert.doesNotMatch(alpha, /shared\?: number/);
  });

  it("answers null for a type that is not declared", () => {
    assert.equal(declarationBody(declaredSource(FIXTURES), "NoSuchType"), null);
  });

  it("refuses a name declared twice, because merged interfaces are legal", () => {
    assert.throws(
      () => declarationBody(declaredSource(FIXTURES), "FixtureMerged"),
      /FixtureMerged is declared 2 times/,
    );
  });
});

describe("assertRequiredMember", () => {
  it("passes a required member and refuses an optional one", () => {
    assert.doesNotThrow(() =>
      assertRequiredMember({
        module: "components/danger-icon-button.tsx",
        declaration: "Props",
        name: "accessibilityLabel",
        type: "string",
        why: "the shipped rule",
      }),
    );
    assert.throws(
      () =>
        assertRequiredMember({
          module: "components/danger-icon-button.tsx",
          declaration: "Props",
          name: "disabled",
          type: "boolean",
          why: "the fixture",
        }),
      /Props's disabled became optional — the fixture/,
    );
  });

  it("answers about the type it was named, not about the module", () => {
    // The reason `declaration` is required. `shared` is required in
    // `FixtureAlpha` and optional in `FixtureBeta`; a module-wide read sees
    // both and gets one of the two questions wrong whichever way it answers.
    assert.doesNotThrow(() =>
      assertRequiredMember({
        module: FIXTURES,
        declaration: "FixtureAlpha",
        name: "shared",
        type: "string",
        why: "the fixture",
      }),
    );
    assert.throws(
      () =>
        assertRequiredMember({
          module: FIXTURES,
          declaration: "FixtureBeta",
          name: "shared",
          type: "number",
          why: "the fixture",
        }),
      /FixtureBeta's shared became optional/,
    );
  });

  it("says so when the type itself is gone, rather than reporting a rename", () => {
    assert.throws(
      () =>
        assertRequiredMember({
          module: FIXTURES,
          declaration: "NoSuchType",
          name: "shared",
          type: "string",
          why: "the fixture",
        }),
      /declares no type NoSuchType/,
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
