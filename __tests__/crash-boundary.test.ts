import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as React from "react";

import { installSpyCapture } from "./helpers/mount-provider";
import { installNativeModuleStubs } from "./helpers/render";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The web half of the crash shell: a React error boundary with no SDK in it.
 *
 * ## Why this is not a `render()` suite
 *
 * The harness in `helpers/render.ts` is a render harness, not a reconciler —
 * it calls function components directly and has no commit phase, so it has no
 * way to throw a render error INTO a boundary. A class boundary's whole
 * contract is three members React calls on its behalf, and each one can be
 * exercised directly: `getDerivedStateFromError` is static and pure,
 * `componentDidCatch` is a method with one side effect, and `render()` is a
 * function of state. That is the contract, so that is what this asserts.
 */

installNativeModuleStubs();

// The shared double rather than a hand-rolled one: it answers for every name
// the app imports from `@/lib/sentry`, and `mount-provider-harness.test.ts`
// sweeps for suites that write their own.
const captured = installSpyCapture();

// Imported after the mocks are registered and without a top-level await —
// the suites run as CJS, so the module is pulled in on first use like
// `use-reactions.test.ts` does.
type BoundaryModule = typeof import("../components/crash-boundary.web");
let boundaryModule: BoundaryModule | null = null;

async function load(): Promise<BoundaryModule> {
  boundaryModule ??= await import("../components/crash-boundary.web");
  return boundaryModule;
}

type BoundaryProps = React.ComponentProps<BoundaryModule["CrashBoundary"]>;

/** A boundary instance with `setState` wired to its own state, as React does. */
async function makeBoundary(fallback: BoundaryProps["fallback"]) {
  const { CrashBoundary } = await load();
  const props = { fallback, children: "the healthy tree" } as unknown as BoundaryProps;
  const boundary = new CrashBoundary(props);
  boundary.setState = (update) => {
    const next = typeof update === "function" ? update(boundary.state, props) : update;
    boundary.state = { ...boundary.state, ...(next as object) };
  };
  return boundary;
}

const FALLBACK: BoundaryProps["fallback"] = ({ error, resetError }) =>
  React.createElement("crash", { error, onReset: resetError });

describe("CrashBoundary (web)", () => {
  it("renders its children while nothing has been caught", async () => {
    const boundary = await makeBoundary(FALLBACK);
    assert.equal(boundary.render(), "the healthy tree");
  });

  it("renders the fallback with the thrown value after a crash", async () => {
    const boundary = await makeBoundary(FALLBACK);
    const thrown = new Error("render blew up");
    boundary.state = (await load()).CrashBoundary.getDerivedStateFromError(thrown);

    const rendered = boundary.render() as React.ReactElement<{ error: unknown }>;
    assert.equal(rendered.type, "crash");
    assert.equal(rendered.props.error, thrown);
  });

  it("shows the fallback for a thrown null, which is legal and reads as no error", async () => {
    // `crashed` exists for exactly this: keyed on `error !== null`, the
    // boundary would render the broken subtree again, throw again, and loop.
    const boundary = await makeBoundary(FALLBACK);
    boundary.state = (await load()).CrashBoundary.getDerivedStateFromError(null);
    assert.equal(boundary.state.crashed, true);

    const rendered = boundary.render() as React.ReactElement<{ error: unknown }>;
    assert.equal(rendered.type, "crash");
    assert.equal(rendered.props.error, null);
  });

  it("resetError puts the children back", async () => {
    const boundary = await makeBoundary(FALLBACK);
    boundary.state = (await load()).CrashBoundary.getDerivedStateFromError(new Error("x"));
    const rendered = boundary.render() as React.ReactElement<{ onReset: () => void }>;

    rendered.props.onReset();

    assert.equal(boundary.state.crashed, false);
    assert.equal(boundary.state.error, null);
    assert.equal(boundary.render(), "the healthy tree");
  });

  it("reports through @/lib/sentry, tagged with its own scope", async () => {
    captured.length = 0;
    const boundary = await makeBoundary(FALLBACK);
    const thrown = new Error("caught");

    boundary.componentDidCatch(thrown);

    assert.equal(captured.length, 1);
    assert.equal(captured[0].error, thrown);
    assert.equal(captured[0].context?.scope, "crash-boundary");
  });

  it("sends no `extra`, which is the component stack being given up", async () => {
    // `analytics-pii.test.ts` rules that an `extra` carries the app's own
    // vocabulary because `scrubPII` never reads it. React's component stack is
    // assembled text, so it stays out rather than the allow-list widening for
    // it — and in a minified bundle the names in it are the minifier's anyway.
    captured.length = 0;
    (await makeBoundary(FALLBACK)).componentDidCatch(new Error("caught"));

    assert.equal(captured[0].context?.extra, undefined);
  });

  it("catching and reporting are separate steps, so a dead reporter still shows the fallback", async () => {
    // `componentDidCatch` runs after `getDerivedStateFromError`; the fallback
    // must not depend on the report succeeding. A screen stuck on a white page
    // because telemetry threw is the worst possible trade.
    const boundary = await makeBoundary(FALLBACK);
    boundary.state = (await load()).CrashBoundary.getDerivedStateFromError(new Error("x"));
    assert.equal((boundary.render() as React.ReactElement).type, "crash");
  });
});

describe("withCrashReporting (web)", () => {
  it("is identity — the instrumentation it would add is native-only", async () => {
    const { withCrashReporting } = await load();
    const Root = () => null;
    assert.equal(withCrashReporting(Root as never), Root);
  });
});

describe("the pair", () => {
  it("native keeps Sentry's own boundary and wrap", () => {
    const native = readRepoFile("components", "crash-boundary.tsx");
    assert.match(native, /from "@sentry\/react-native"/);
    assert.match(native, /<ErrorBoundary fallback=\{fallback\}>/);
    assert.match(native, /return wrap\(RootComponent\);/);
  });

  it("both halves describe the same fallback contract", () => {
    // `check-platform-pairs` holds the exported NAMES in step; what it cannot
    // see is that one half hands its fallback an `eventId` the other has no
    // way to produce, so the shared shape is the narrow one both can honour.
    for (const file of ["crash-boundary.tsx", "crash-boundary.web.tsx"]) {
      const src = readRepoFile("components", file);
      assert.match(
        src,
        /export type CrashFallbackRender = \(data: \{\s*error: unknown;\s*resetError: \(\) => void;\s*\}\) => ReactElement;/,
        `${file} must declare the shared fallback contract`,
      );
    }
  });
});
