import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseStoredChoice,
  parseStoredDiagnostics,
  readDoNotTrack,
  resolveDiagnosticsEnabled,
} from "../lib/diagnostics-context";

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
  /**
   * The provider's hydrate `.catch` had no fallback at all, so a device whose
   * store could not be read kept this component's `useState(true)` — the
   * toggle read "on" for a user whose browser says DO NOT TRACK, while the
   * SDKs stayed off because that arm never started them. The screen and the
   * behaviour disagreed, in the direction that looks like the preference was
   * ignored.
   *
   * This is the pure half: `resolveDiagnosticsEnabled(null, dnt)` is what an
   * unknown stored choice means, and it is the same answer a device with
   * nothing stored gets.
   *
   * The three cases that used to sit here were regexes over the catch arm's
   * TEXT — "does it mention `resolveDiagnosticsEnabled(null, readDoNotTrack())`",
   * "does it not mention `initSentry`" — written under a comment saying the
   * provider could not be mounted because that would start the real SDKs. It
   * can: `mockModule` replaces the three initialisers, and
   * `diagnostics-provider-mounted.test.ts` now asserts the same three facts by
   * running the arm, plus the ordering a source scan cannot see. They are gone
   * rather than kept beside it, because a rule that reads a regex over a
   * comment block is not a second opinion on the behaviour — it is a second
   * way to pass while the behaviour is wrong.
   */
  it("resolves an unknown stored choice exactly as it resolves no stored choice", () => {
    assert.equal(resolveDiagnosticsEnabled(null, true), false);
    assert.equal(resolveDiagnosticsEnabled(null, false), true);
  });
});
