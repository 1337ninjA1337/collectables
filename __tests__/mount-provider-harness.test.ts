import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, useEffect, useState } from "react";

import { balancedInner } from "@/lib/balanced-source";
import { stripComments } from "@/lib/strip-comments";

import { autoUnmount, render } from "./helpers/render";

// Ends every tree a case rendered, including the cases that fail early.
autoUnmount();
import {
  drain,
  inertSentryStatus,
  providerHarness,
  settle,
  SENTRY_NAMES_THE_APP_CALLS,
  SENTRY_STATUS_FIELDS_THE_STUB_ANSWERS,
} from "./helpers/mount-provider";
import { declaredMembers, declaredSource } from "./helpers/declared-shape";
import { readRepoFile } from "./helpers/repo-file";
import { readSource, sourceFiles } from "./helpers/source-files";
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
 * `installSpyAsyncStorage` and `installSpyCapture` are deliberately NOT
 * exercised here: both register a process-wide module mock, and a suite that
 * installed one would be mocking AsyncStorage — or `@/lib/sentry` — for its own
 * imports too. They are covered by the nine suites that use them, plus the
 * source cases in Adoption below, which is where the two facts a caller relies
 * on live: that the spy RECORDS rather than discards, and that a caller's extra
 * exports cannot displace the recorder.
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

/** The shape the capture sweep looks for, and the reason it must be a `const`. */
const CAPTURE_DOUBLE = 'mockModule("@/lib/sentry"';

/**
 * The sweep below has to spell the shape it forbids, which makes this file its
 * own only offender — a guard cannot search for a string without containing it.
 * `assertExemptionsHonest` keeps the hole from outliving the search: the entry
 * is live only while this suite still holds the needle.
 */
const OWN_CAPTURE_DOUBLE = ["mount-provider-harness.test.ts"];

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

  it("the suite that searches for the shape is the only one that may contain it", () => {
    assertExemptionsHonest({
      exemptions: OWN_CAPTURE_DOUBLE,
      expected: ["mount-provider-harness.test.ts"],
      rule: "shared Sentry capture spy",
      walk: topLevelSuites(),
      stillNeeded: (name) => readSuite(name).includes(CAPTURE_DOUBLE),
    });
  });

  it("no suite hand-rolls a Sentry capture double", () => {
    const offenders = topLevelSuites()
      .filter((name) => !OWN_CAPTURE_DOUBLE.includes(name))
      .filter((name) => readSuite(name).includes(CAPTURE_DOUBLE));

    assert.deepEqual(
      offenders,
      [],
      "use installSpyCapture() from ./helpers/mount-provider — pass extra exports as its argument, since a second mockModule call for one specifier replaces the first",
    );
  });

  it("the capture spy records rather than discards, so silence stays a question", () => {
    const source = readRepoFile("__tests__/helpers/mount-provider.ts");
    const start = source.indexOf("export function installSpyCapture");
    // The `{` after the RETURN TYPE, not the one in the `= {}` default.
    const open = source.indexOf("{", source.indexOf("CapturedReport[]", start));
    const body = balancedInner(source, open, "{", "}") ?? "";

    assert.match(
      body,
      /captured\.push\(\{ error, context \}\)/,
      "a discarding double answers 'was anything reported?' the same way a broken report path does",
    );
    assert.match(
      body,
      /\.\.\.extraExports,\s*\n\s*captureException:/,
      "the spread must come FIRST — an extraExports entry named captureException would otherwise silently replace the recorder",
    );
  });

  it("the capture spy answers for every name the app imports from @/lib/sentry", () => {
    // The double replaces the WHOLE module, so a name it does not answer for is
    // `undefined` at the call site and the failure is "x is not a function"
    // several frames inside a provider — which reads as a bug in the provider.
    // Derived from the app's own imports rather than from `lib/sentry`'s
    // exports: a helper nobody calls needs no stub, and a ninth name that
    // somebody starts calling needs one before the crash.
    const imported = new Set<string>();
    for (const file of sourceFiles("lib", "components", "app")) {
      for (const m of readSource(file).matchAll(
        /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"@\/lib\/sentry"/g,
      )) {
        if (m[1]) continue;
        for (const entry of m[2].split(",")) {
          const name = entry.trim().split(/\s+as\s+/)[0].trim();
          if (name && !name.startsWith("type ")) imported.add(name);
        }
      }
    }

    assert.ok(imported.size > 0, "the import sweep found nothing — the parse, not the app");
    assert.deepEqual(
      [...SENTRY_NAMES_THE_APP_CALLS].sort(),
      [...imported].sort(),
      "add the name to INERT_SENTRY in helpers/mount-provider.ts, or drop it if the app stopped calling it",
    );
  });

  it("the getSentryStatus stub answers for every field SentryStatus declares", () => {
    // A missing NAME crashes; a missing FIELD does not, which is the worse of
    // the two. The stub returned `{}`, so a provider reading `.ready` off it
    // got `undefined` and took the falsy path — the same path a not-ready
    // Sentry produces, so the case passed and proved nothing. `reason` is the
    // field with no falsy member at all: a `switch` over it falls through a
    // default the app never expects to reach.
    //
    // Derived from the TYPE rather than from the app's reads, unlike the name
    // sweep above: the whole object crosses the boundary in one return value,
    // so a field the app has not read yet is one `status.x` away from being
    // read, and the stub is either the shape or it is a subset that happens to
    // work today.
    const declared = declaredMembers(declaredSource("lib/sentry.ts"), "SentryStatus");

    assert.ok(declared.length > 0, "the member read found nothing — the parse, not the type");
    assert.deepEqual(
      [...SENTRY_STATUS_FIELDS_THE_STUB_ANSWERS].sort(),
      [...declared].sort(),
      "fill the field in INERT_SENTRY_STATUS in helpers/mount-provider.ts, or drop it if SentryStatus did",
    );
  });

  it("the stub hands out a fresh status object per call", () => {
    // The real one builds its snapshot each time. A shared literal would let a
    // case that mutates what it read change what the next case sees, which is
    // the shape of leak this harness exists to close one level up.
    const first = inertSentryStatus();
    const second = inertSentryStatus();

    assert.notEqual(first, second, "same object twice — one case's mutation is every case's");
    assert.deepEqual(first, second);
    assert.equal(first.reason, "not-initialised", "the state a mounted suite is really in");
    assert.equal(first.ready, false);
  });

  it("the report helper imports the app's reason and context types rather than restating them", () => {
    const source = readRepoFile("__tests__/helpers/storage-failure-report.ts");

    assert.match(
      source,
      /import type \{ CaptureContext \} from "\.\.\/\.\.\/lib\/sentry"/,
      "`context: unknown` is what forced three suites to restate the shape they read `.scope` off",
    );
    assert.match(
      source,
      /import type \{ StorageFailureReason \} from "\.\.\/\.\.\/lib\/report-storage-failure"/,
      "a hand-written union keeps compiling after a third reason is added, and only the app knows",
    );
    assert.doesNotMatch(
      stripComments(source),
      /"full" \| "unavailable"/,
      "the union is the app's — a copy of it here is the thing the type import removed",
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
