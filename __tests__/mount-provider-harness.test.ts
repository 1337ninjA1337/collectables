import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, useEffect, useState } from "react";

import { render } from "./helpers/render";
import { drain, providerHarness, settle } from "./helpers/mount-provider";
import { assertExemptionsHonest, readSuite, topLevelSuites } from "./helpers/suite-files";

/**
 * The mounted-provider harness, tested by being used.
 *
 * Six providers are mounted rather than source-scanned, and four of them now
 * share `helpers/mount-provider.ts`. That makes `drain()` load-bearing for
 * every leak case in the tree: a drain that returns too early turns "nothing
 * was written under user B's key" into "nothing had run yet", and the case
 * passes. Nothing tested the drain itself, which is how the fixed pass counts
 * it replaced survived four suites.
 *
 * `installSpyAsyncStorage` is deliberately NOT exercised here: it registers a
 * process-wide module mock, and a suite that installed it would be mocking
 * AsyncStorage for its own imports too.
 */

// ---------------------------------------------------------------------------
// drain()
// ---------------------------------------------------------------------------

/**
 * A hydrate, in miniature: `steps` state updates, each one macrotask after the
 * last, from a promise chain the render harness knows nothing about.
 */
function makeSlowHydrate(steps: number) {
  const seen: number[] = [];

  function SlowHydrate() {
    const [step, setStep] = useState(0);
    seen.push(step);
    useEffect(() => {
      let cancelled = false;
      void (async () => {
        for (let index = 1; index <= steps; index += 1) {
          await settle();
          if (!cancelled) setStep(index);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []);
    return createElement("View", { "data-step": step });
  }

  return { SlowHydrate, seen };
}

/** An effect with no dependency array that sets the state it renders. */
function Runaway() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount((previous) => previous + 1);
  });
  return createElement("View", { "data-count": count });
}

describe("drain — waiting for an async hydrate", () => {
  it("catches every step of a chain that resolves over several macrotasks", async () => {
    const { SlowHydrate, seen } = makeSlowHydrate(3);
    const tree = render(createElement(SlowHydrate));

    await drain(tree);

    assert.equal(
      tree.findByType("View").props["data-step"],
      3,
      "a drain that stops one macrotask early is how a leak case passes by not having run",
    );
    assert.deepEqual(seen, [0, 1, 2, 3], "and every intermediate render happened once");
  });

  it("returns without re-rendering a tree that has already settled", async () => {
    const { SlowHydrate } = makeSlowHydrate(0);
    const tree = render(createElement(SlowHydrate));

    await drain(tree);

    assert.equal(tree.dirty, false);
  });

  it("throws rather than looping forever on an effect that sets its own input", async () => {
    const tree = render(createElement(Runaway));

    await assert.rejects(
      () => drain(tree, 5),
      /still re-rendering after 5 passes/,
      "a tree that never settles is a bug, and the message should say which kind",
    );
  });
});

// ---------------------------------------------------------------------------
// providerHarness()
// ---------------------------------------------------------------------------

type Value = { count: number; bump: () => void };

function makeProvider() {
  let latest: Value | null = null;

  function Provider({ children }: React.PropsWithChildren) {
    const [count, setCount] = useState(0);
    latest = { count, bump: () => setCount((previous) => previous + 1) };
    return createElement("View", null, children);
  }

  return {
    Provider,
    useValue: () => latest!,
  };
}

describe("providerHarness — capturing the context value", () => {
  let loads = 0;

  const harness = providerHarness<Value>(async () => {
    loads += 1;
    return makeProvider();
  });

  beforeEach(() => {
    harness.reset();
  });

  it("has no value before a mount, and says so rather than returning null", async () => {
    assert.equal(harness.seen, null);
    assert.throws(() => harness.value(), /no render has happened yet/);
  });

  it("captures the value the probe saw", async () => {
    await harness.mount();

    assert.equal(harness.value().count, 0);
  });

  it("loads the provider module exactly once across mounts", async () => {
    const before = loads;
    await harness.mount();
    await harness.mount();

    assert.equal(loads, before, "the module was already imported by an earlier case");
  });

  it("re-reads the value after a re-render", async () => {
    const tree = await harness.mount();

    harness.value().bump();
    await drain(tree);

    assert.equal(harness.value().count, 1);
  });
});

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

/**
 * The two single-key suites keep their own store double on purpose: their
 * providers read ONE key, so those doubles answer every `getItem` with the same
 * `stored` string and their cases set that string rather than a map entry.
 * Converting them would be churn with no fact behind it.
 */
const OWN_STORE_DOUBLE = [
  "diagnostics-provider-mounted.test.ts",
  "i18n-provider-mounted.test.ts",
];

describe("the mounted-provider suites share one harness", () => {
  it("the two suites keeping their own double still have one", () => {
    assertExemptionsHonest({
      exemptions: OWN_STORE_DOUBLE,
      expected: ["diagnostics-provider-mounted.test.ts", "i18n-provider-mounted.test.ts"],
      rule: "shared AsyncStorage spy",
      walk: topLevelSuites(),
      stillNeeded: (name) =>
        readSuite(name).includes('mockModule("@react-native-async-storage/async-storage"'),
    });
  });

  it("no multi-key suite hand-rolls an AsyncStorage double", () => {
    const offenders = topLevelSuites()
      .filter((name) => name.endsWith("-provider-mounted.test.ts"))
      .filter((name) => !OWN_STORE_DOUBLE.includes(name))
      .filter((name) =>
        readSuite(name).includes(
          'mockModule("@react-native-async-storage/async-storage"',
        ),
      );

    assert.deepEqual(
      offenders,
      [],
      "use installSpyAsyncStorage() from ./helpers/mount-provider — it records reads, writes, and both failure modes",
    );
  });

  it("no mounted-provider suite drains with a hand-counted number of passes", () => {
    const offenders = topLevelSuites()
      .filter((name) => name.endsWith("-provider-mounted.test.ts"))
      .filter((name) => /async function drain\(/.test(readSuite(name)));

    assert.deepEqual(
      offenders,
      [],
      "a local drain() is a claim about how many awaits a hydrate holds, written nowhere near the hydrate",
    );
  });
});
