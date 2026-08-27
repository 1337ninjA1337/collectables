import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CAPTURED, beginCapture, captureConsole } from "./helpers/capture-console";
import { sourceCode, sourceFiles } from "./helpers/source-files";
import { suiteCode, topLevelSuites } from "./helpers/suite-files";

/**
 * A seam that defaults to the global console, and the overload nobody calls.
 *
 * The shape: a function that logs takes its console as a parameter defaulted to
 * the real one — `out: Pick<Console, "log" | "error"> = console` — so a case can
 * be the console. Then every case is, and the DEFAULT goes unexercised. Which
 * means the spelling that runs in production is the one with no cover at all:
 * it could name a method the console does not have, could be dropped in favour
 * of a required parameter, could be changed to `console.error` for both
 * streams, and the suite beside it stays green while the guard prints nothing
 * and the dev build crashes on its first debug line.
 *
 * It is not a hypothetical failure mode; it is what both seams in this tree
 * looked like this morning. `printProvenanceOutput`'s default is what
 * `npm run lint:baseline-provenance` prints through, and `createDevLogger`'s is
 * what the app-wide `devLog` is built from — neither had a case that omitted
 * the argument.
 *
 * WHY A SWEEP AND NOT TWO CASES. Two cases fix today's two. The rule is that a
 * THIRD seam cannot arrive without one, and the population is derivable: a
 * defaulted console parameter is a distinctive line, so the modules that have
 * one can be found rather than listed. What cannot be derived is "the default
 * is exercised" — no static read tells you a case omitted an argument — so the
 * rule asks for the closest observable proxy: the module's suite reaches for
 * {@link captureConsole}, which is the only way in this tree to watch the
 * global console. A suite that imports it and asserts nothing is a way to pass
 * this dishonestly; a suite that never imports it is a seam with no cover, and
 * that is the state the sweep exists to catch.
 *
 * THE TWO SEAMS THIS IS ABOUT, named here because both name this file and the
 * cross-reference ran one way: `printProvenanceOutput` in `lib/provenance-report.ts`
 * and `createDevLogger` in `lib/safe-log.ts`. The list is a courtesy, not the
 * rule — {@link SEAMS} is derived, so a third arrives covered by the sweep and
 * uncovered by this paragraph, which is the right way round.
 */

/**
 * `= console` on a parameter, whatever the parameter is called or typed.
 *
 * Bounded by `[^\n=]` rather than by `[^,()]`: both seams today are typed
 * `Pick<Console, "log" | "error">`, so a comma and a pair of angle brackets sit
 * between the colon and the default, and a character class that excluded commas
 * matched neither of them.
 */
const DEFAULTS_TO_CONSOLE = /:\s*[^\n=]*Console[^\n=]*=\s*console\s*[,)]/;

/** Modules declaring a console-defaulted parameter, found rather than listed. */
const SEAMS = sourceFiles("lib", "scripts").filter((file) =>
  DEFAULTS_TO_CONSOLE.test(sourceCode(file)),
);

/** `../lib/safe-log` and `@/lib/safe-log` both name `lib/safe-log.ts`. */
function importsModule(suite: string, module: string): boolean {
  const stem = module.replace(/^lib\//, "").replace(/\.ts$/, "");
  return new RegExp(`from\\s+"(?:\\.\\./lib|@/lib)/${stem}"`).test(
    suiteCode(suite),
  );
}

describe("a console-defaulted seam", () => {
  it("is a shape this tree still has, so the rule below is not swept over nothing", () => {
    // The positive control. This sweep reads an ABSENCE — no seam without
    // cover — and a tree with no seams at all would satisfy it perfectly. Two
    // is the count today and the floor, because a seam being REMOVED is a real
    // outcome (the parameter becomes required) and should not be ratified here;
    // what must not happen silently is the set emptying.
    assert.ok(
      SEAMS.length >= 1,
      `no module declares a console-defaulted parameter any more — either the seams became required parameters, in which case delete this suite, or the pattern stopped matching: ${DEFAULTS_TO_CONSOLE.source}`,
    );
  });

  it("has a suite that watches the real console, not only the parameter", () => {
    const uncovered = SEAMS.filter((seam) => {
      const suites = topLevelSuites().filter((suite) =>
        importsModule(suite, seam),
      );
      return !suites.some((suite) => suiteCode(suite).includes("captureConsole"));
    });
    assert.deepEqual(
      uncovered,
      [],
      `these modules default a console parameter and no suite of theirs calls captureConsole, so the overload that runs in production is the one with no case: ${uncovered.join(", ")}`,
    );
  });

  it("is watched by a helper that gives the console back", () => {
    // The one thing that makes this helper worse than the gap it closes: a
    // callback that throws, leaving the runner with a console that pushes into
    // a dead array. Asserted rather than trusted to the `finally` being read.
    const before = console.log;
    assert.throws(() => {
      captureConsole(() => {
        throw new Error("boom");
      });
    }, /boom/);
    assert.equal(
      console.log,
      before,
      "captureConsole did not restore console.log after a throwing callback",
    );
  });

  it("is watched by a helper that reports what was written, per stream", () => {
    const written = captureConsole(() => {
      console.log("one", "two");
      console.error("bad");
    });
    // Joined the way the console joins them, so a caller that spreads several
    // values into one call reads back as one line rather than as three.
    assert.deepEqual(written.log, ["one two"]);
    assert.deepEqual(written.error, ["bad"]);
  });

  it("watches every stream, not only the two the seams use", () => {
    // The reason the helper grew three more channels: two suites had written
    // the same twelve-line `withCapturedWarns` byte for byte, because a helper
    // that only knew `log` and `error` sent anyone testing a `console.warn`
    // back to swapping the method by hand.
    const before = { ...console };
    const written = captureConsole(() => {
      console.warn("careful");
      console.info("fyi");
      console.debug("noisy");
    });
    assert.deepEqual(written.warn, ["careful"]);
    assert.deepEqual(written.info, ["fyi"]);
    assert.deepEqual(written.debug, ["noisy"]);
    // CAPTURED rather than a sixth spelling of the same five names — the whole
    // point of the list being exported is that nothing restates it.
    for (const method of CAPTURED) {
      assert.equal(
        console[method],
        before[method],
        `captureConsole did not restore console.${method}`,
      );
    }
  });

  it("hands back what the callback returned, so one call answers both questions", () => {
    // The shape both retired copies had: run a function, read what it returned
    // AND what it printed. Without it the adopting suites would have had to
    // assign into a local from inside the callback at ten sites.
    const written = captureConsole(() => {
      console.warn("said something");
      return { kept: 1 };
    });
    assert.deepEqual(written.result, { kept: 1 });
    assert.deepEqual(written.warn, ["said something"]);
  });

  /**
   * The async callback, refused rather than silently half-captured.
   *
   * The doc comment used to claim the signature enforced synchrony. It does
   * not: `() => T` accepts an `async` arrow, and so did the `() => void` it
   * replaced. An async callback captures up to its first `await` and then logs
   * through a restored console — or, since the runner interleaves cases,
   * through the NEXT case's capture, which is a failure that shows up somewhere
   * else entirely.
   */
  it("refuses an async callback, with the console already given back", () => {
    const before = console.log;
    assert.throws(
      () => captureConsole(async () => {
        await Promise.resolve();
      }),
      /async callback/,
    );
    assert.equal(
      console.log,
      before,
      "captureConsole refused an async callback without restoring the console first",
    );
  });

  it("refuses any thenable, not only a native promise", () => {
    // The check is on the SHAPE, because a callback returning a hand-rolled
    // thenable (or a library's promise) has exactly the same problem and would
    // pass an `instanceof Promise`.
    assert.throws(
      () => captureConsole(() => ({ then: () => undefined })),
      /async callback/,
    );
  });

  it("lets an ordinary object through, so the refusal is about thenables", () => {
    // The negative control: `result` is a normal return channel, and a check
    // that refused every object would have made it useless.
    assert.deepEqual(
      captureConsole(() => ({ then: "not a function" })).result,
      { then: "not a function" },
    );
  });
});

/**
 * The rule that could not be written while five suites were exempt from it.
 *
 * `captureConsole` closed the seam and made the two-suite copy of
 * `withCapturedWarns` unnecessary, and it still left five suites swapping a
 * method by hand — `sentry-init`, `sentry-config`, `analytics-init`,
 * `analytics-status`, `clarity` — for three reasons a callback cannot serve: a
 * swap held across `beforeEach`/`afterEach`, an `await`ed body (which the
 * thenable refusal exists to reject), and silencing rather than capturing. A
 * ban written then would have been five exemptions out of seven, which is a
 * paragraph pretending to be a rule.
 *
 * `beginCapture` serves all three, so the ban is written here with NO
 * exemptions and the list above is now the list of suites that adopted it. What
 * it buys is not tidiness: a hand-rolled swap saves and restores ONE method, so
 * a case that starts writing to a second stream loses it into the runner's
 * output, and one that throws before its `finally` leaves the next case
 * pushing into a dead array.
 */
describe("the global console in the suites", () => {
  /**
   * `console.warn =` and `console[method] =`, however either is spaced.
   *
   * Both forms, because the helper itself uses the bracket one — a ban that
   * only knew the dotted spelling would be dodged by the exact line it is meant
   * to be the single instance of. `[^=]` keeps `console.warn ===` out.
   */
  const SWAPS_A_CONSOLE_METHOD =
    /console\s*(?:\.(?:log|error|warn|info|debug)|\[[^\]]+\])\s*=[^=]/;

  it("is swapped in exactly one place, and that place is the helper", () => {
    const swapping = topLevelSuites().filter((suite) =>
      SWAPS_A_CONSOLE_METHOD.test(suiteCode(suite)),
    );
    assert.deepEqual(
      swapping,
      [],
      `these suites swap a console method by hand instead of going through captureConsole/beginCapture, which saves one stream and loses the rest: ${swapping.join(", ")}`,
    );
  });

  it("is swept over a rule the helper itself would fail, so the pattern is not dead", () => {
    // The positive control. A ban that matches nothing is satisfied by a
    // pattern that no longer matches anything at all, and the one file in the
    // tree that legitimately does the banned thing is the proof it still bites.
    assert.match(
      sourceCode("__tests__/helpers/capture-console.ts"),
      SWAPS_A_CONSOLE_METHOD,
      "capture-console.ts stopped assigning to a console method, so the ban above is being read by a pattern that matches nothing",
    );
  });
});

describe("beginCapture", () => {
  it("keeps collecting across an await, which is what the callback form cannot do", async () => {
    const captured = beginCapture();
    try {
      console.warn("before");
      await Promise.resolve();
      console.warn("after");
    } finally {
      captured.restore();
    }
    // Both halves, and readable AFTER the restore — which is what lets the
    // assertions sit outside the `finally` that closed the capture.
    assert.deepEqual(captured.warn, ["before", "after"]);
  });

  it("restores idempotently, so a late second restore cannot clobber the next capture", () => {
    // The shape a `finally` and an `afterEach` produce together: the case
    // restored already, and the hook restores again — by which time the NEXT
    // case has opened its own capture. A restore that ran twice would put the
    // pre-first console back over the second swap, and everything the second
    // capture was opened for would print into the runner's output instead.
    const first = beginCapture();
    first.restore();
    const second = beginCapture();
    first.restore();
    console.warn("still captured");
    second.restore();
    assert.deepEqual(second.warn, ["still captured"]);
  });

  it("refuses to nest, and gives the console back to the leaked capture first", () => {
    // The trade this form makes: no `finally` of its own, so a caller that
    // forgets `restore()` swallows everything after it. It cannot be made safe
    // from the helper, so it is made loud at the NEXT capture.
    const before = console.log;
    const leaked = beginCapture();
    assert.throws(() => beginCapture(), /while a beginCapture\(\) was still open/);
    assert.equal(
      console.log,
      before,
      "the nesting refusal left the leaked capture holding the console",
    );
    // And the refusal closed it, so the suite carries on rather than every
    // later case in the file inheriting the leak.
    assert.doesNotThrow(() => captureConsole(() => undefined));
    leaked.restore();
  });

  it("is refused by captureConsole too, since both take the same one console", () => {
    const leaked = beginCapture();
    assert.throws(
      () => captureConsole(() => undefined),
      /captureConsole\(\) was called while a beginCapture\(\)/,
    );
    leaked.restore();
  });
});

/**
 * One list, three readers.
 *
 * `CAPTURED` is the methods the helper swaps; `CapturedConsole` and
 * `OpenCapture` are mapped over it, and `install()` builds its collectors from
 * it. Those were ten hand-written fields and a five-key object literal beside
 * one array — four places for a sixth stream to be added to three of. The types
 * cannot disagree with the list any more, because they are the list; what a
 * type cannot check is that the RUNTIME shape matches too, which is what a
 * swapped-but-uncollected stream would look like.
 */
describe("the captured streams and the list they come from", () => {
  it("hands back exactly the streams CAPTURED names, and nothing else", () => {
    const captured = captureConsole(() => {});
    const { result, ...streams } = captured;
    assert.equal(result, undefined);
    assert.deepEqual(Object.keys(streams).sort(), [...CAPTURED].sort());
  });

  it("gives the caller-owned form the same streams beside its restore", () => {
    const capture = beginCapture();
    try {
      const { restore, ...streams } = capture;
      assert.equal(typeof restore, "function");
      assert.deepEqual(Object.keys(streams).sort(), [...CAPTURED].sort());
    } finally {
      capture.restore();
    }
  });

  it("collects into every stream it swapped, so none is swapped and dropped", () => {
    // The failure a mapped type cannot see: a method replaced by the installer
    // whose writes go nowhere reads, from outside, as a stream nobody used.
    const written = captureConsole(() => {
      for (const method of CAPTURED) console[method](`from ${method}`);
    });
    for (const method of CAPTURED) {
      assert.deepEqual(
        written[method],
        [`from ${method}`],
        `console.${method} was swapped and what it wrote did not reach the capture`,
      );
    }
  });

  it("names each stream once in the helper, not once per result type", () => {
    // The floor under the derivation. Each method name appears in CAPTURED and
    // in this suite's prose; a helper that went back to hand-written fields
    // would carry each of the five twice more.
    const helper = sourceCode("__tests__/helpers/capture-console.ts");
    for (const method of CAPTURED) {
      const occurrences = helper.split(`"${method}"`).length - 1;
      assert.equal(
        occurrences,
        1,
        `"${method}" is written ${occurrences} times in capture-console.ts — the list is CAPTURED, and a second spelling is a stream that can be added to one place and missed in another`,
      );
    }
  });
});
