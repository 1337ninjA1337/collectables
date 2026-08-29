import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseStoredChoice,
  parseStoredDiagnostics,
  readDoNotTrack,
  resolveDiagnosticsEnabled,
} from "../lib/diagnostics-context";
import { readRepoFile } from "./helpers/repo-file";

type MutableGlobal = {
  navigator?: { doNotTrack?: string | null; msDoNotTrack?: string | null };
  doNotTrack?: string | null;
};

const g = globalThis as MutableGlobal;
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
const originalDoNotTrack = g.doNotTrack;

function restoreGlobals() {
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    delete g.navigator;
  }
  if (originalDoNotTrack === undefined) {
    delete g.doNotTrack;
  } else {
    g.doNotTrack = originalDoNotTrack;
  }
}

function setNavigator(nav: MutableGlobal["navigator"] | undefined) {
  Object.defineProperty(globalThis, "navigator", {
    value: nav,
    configurable: true,
    writable: true,
  });
}

describe("Analytics #18 — parseStoredChoice", () => {
  it("returns null when nothing is stored", () => {
    assert.equal(parseStoredChoice(null), null);
    assert.equal(parseStoredChoice(""), null);
  });

  it("returns the explicit boolean choice", () => {
    assert.equal(parseStoredChoice('{"enabled":true}'), true);
    assert.equal(parseStoredChoice('{"enabled":false}'), false);
  });

  it("returns null for malformed JSON or a missing enabled field", () => {
    assert.equal(parseStoredChoice("not json"), null);
    assert.equal(parseStoredChoice("{}"), null);
    assert.equal(parseStoredChoice('{"enabled":"yes"}'), null);
  });
});

describe("Analytics #18 — parseStoredDiagnostics back-compat", () => {
  it("defaults to opt-in unless an explicit false is stored", () => {
    assert.equal(parseStoredDiagnostics(null), true);
    assert.equal(parseStoredDiagnostics("{}"), true);
    assert.equal(parseStoredDiagnostics('{"enabled":true}'), true);
    assert.equal(parseStoredDiagnostics("garbage"), true);
    assert.equal(parseStoredDiagnostics('{"enabled":false}'), false);
  });
});

describe("Analytics #18 — readDoNotTrack", () => {
  afterEach(restoreGlobals);

  it("is false when no navigator/doNotTrack surface exists", () => {
    setNavigator(undefined);
    delete g.doNotTrack;
    assert.equal(readDoNotTrack(), false);
  });

  it("honours navigator.doNotTrack === '1'", () => {
    setNavigator({ doNotTrack: "1" });
    assert.equal(readDoNotTrack(), true);
  });

  it("is false for unspecified / '0' / null", () => {
    setNavigator({ doNotTrack: "unspecified" });
    assert.equal(readDoNotTrack(), false);
    setNavigator({ doNotTrack: "0" });
    assert.equal(readDoNotTrack(), false);
    setNavigator({ doNotTrack: null });
    delete g.doNotTrack;
    assert.equal(readDoNotTrack(), false);
  });

  it("honours legacy window.doNotTrack 'yes' and IE msDoNotTrack '1'", () => {
    setNavigator({});
    g.doNotTrack = "yes";
    assert.equal(readDoNotTrack(), true);
    delete g.doNotTrack;
    setNavigator({ msDoNotTrack: "1" });
    assert.equal(readDoNotTrack(), true);
  });
});

describe("Analytics #18 — resolveDiagnosticsEnabled", () => {
  it("explicit stored choice always wins over DNT", () => {
    assert.equal(resolveDiagnosticsEnabled('{"enabled":true}', true), true);
    assert.equal(resolveDiagnosticsEnabled('{"enabled":false}', false), false);
  });

  it("no stored choice + DNT on → opt-out", () => {
    assert.equal(resolveDiagnosticsEnabled(null, true), false);
    assert.equal(resolveDiagnosticsEnabled("{}", true), false);
  });

  it("no stored choice + DNT off → opt-in", () => {
    assert.equal(resolveDiagnosticsEnabled(null, false), true);
    assert.equal(resolveDiagnosticsEnabled("garbage", false), true);
  });
});

describe("an unreadable store lands on the same branch as an empty one", () => {
  const SOURCE = readRepoFile("lib/diagnostics-context.tsx");

  /**
   * The provider's hydrate `.catch` had no fallback at all, so a device whose
   * store could not be read kept this component's `useState(true)` — the
   * toggle read "on" for a user whose browser says DO NOT TRACK, while the
   * SDKs stayed off because that arm never started them. The screen and the
   * behaviour disagreed, in the direction that looks like the preference was
   * ignored.
   *
   * Structural, because mounting the provider would start the real SDK
   * initialisers. What is asserted by CALLING is the rule the arm now uses:
   * `resolveDiagnosticsEnabled(null, dnt)` is what an unknown stored choice
   * means, and it is the same answer a device with nothing stored gets.
   */
  it("resolves an unknown stored choice exactly as it resolves no stored choice", () => {
    assert.equal(resolveDiagnosticsEnabled(null, true), false);
    assert.equal(resolveDiagnosticsEnabled(null, false), true);
  });

  it("the catch arm consults Do-Not-Track rather than the useState default", () => {
    const catchArm = SOURCE.slice(SOURCE.indexOf(".catch((error: unknown) => {"));
    assert.match(
      catchArm.slice(0, 1400),
      /resolveDiagnosticsEnabled\(null, readDoNotTrack\(\)\)/,
      "an unreadable store must fall back to the same rule an empty one does",
    );
  });

  it("the catch arm still starts no SDK, whatever it resolves", () => {
    // `next` decides what the TOGGLE says and what a later flip will do. An
    // unknown consent state must not produce telemetry nobody agreed to, so
    // the initialisers stay out of this arm even when it resolves to opt-in;
    // the next launch that can read the store starts them.
    const catchArm = SOURCE.slice(SOURCE.indexOf(".catch((error: unknown) => {"));
    assert.doesNotMatch(
      catchArm.slice(0, 1400),
      /\b(?:initSentry|initAnalytics|initClarity)\(/,
      "a failed read must not start collection",
    );
  });

  it("still reports, because nothing else would mention an unreadable preference", () => {
    const catchArm = SOURCE.slice(SOURCE.indexOf(".catch((error: unknown) => {"));
    assert.match(catchArm.slice(0, 1400), /reportStorageFailure\("diagnostics-context\.getItem"/);
  });
});
