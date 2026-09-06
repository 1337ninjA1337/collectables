import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { setupFakeDom, type FakeNode } from "./helpers/fake-dom";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Regression coverage for the shared fake-DOM helper so future web-only
 * module tests (script injection, meta tags, service workers) can rely on
 * its contract without re-verifying it locally.
 */

type G = { window?: unknown; document?: unknown };
const g = globalThis as unknown as G;

describe("__tests__/helpers/fake-dom", () => {
  it("swaps globalThis.window/document and restore() puts the originals back", () => {
    const prevWindow = g.window;
    const prevDocument = g.document;
    const fake = setupFakeDom();
    try {
      assert.equal(g.window, fake.fakeWindow);
      assert.ok(g.document, "document installed");
    } finally {
      fake.restore();
    }
    assert.equal(g.window, prevWindow);
    assert.equal(g.document, prevDocument);
  });

  it("createElement registers ids in byId and getElementById resolves them", () => {
    const fake = setupFakeDom();
    try {
      const doc = g.document as {
        createElement: (tag: string) => { id?: string };
        getElementById: (id: string) => unknown;
      };
      const node = doc.createElement("script");
      assert.equal(doc.getElementById("my-tag"), null);
      node.id = "my-tag";
      assert.equal(doc.getElementById("my-tag"), node);
      assert.equal(fake.created.length, 1);
      assert.equal(fake.byId["my-tag"], node);
    } finally {
      fake.restore();
    }
  });

  it("head records appendChild/insertBefore/removeChild and maintains parentNode", () => {
    const fake = setupFakeDom();
    try {
      const node: FakeNode = {};
      fake.head.appendChild(node);
      assert.equal(fake.head.appended[0], node);
      assert.equal(node.parentNode, fake.head);

      const inserted: FakeNode = {};
      fake.head.insertBefore(inserted, node);
      assert.deepEqual(fake.head.inserted[0], { node: inserted, before: node });

      fake.head.removeChild(node);
      assert.equal(fake.head.removed[0], node);
      assert.equal(node.parentNode, null);
    } finally {
      fake.restore();
    }
  });

  it("hasFirstScript toggles getElementsByTagName between one script and none", () => {
    const withScript = setupFakeDom();
    try {
      const doc = g.document as { getElementsByTagName: (t: string) => unknown[] };
      assert.equal(doc.getElementsByTagName("script").length, 1);
    } finally {
      withScript.restore();
    }
    const without = setupFakeDom({ hasFirstScript: false });
    try {
      const doc = g.document as { getElementsByTagName: (t: string) => unknown[] };
      assert.equal(doc.getElementsByTagName("script").length, 0);
    } finally {
      without.restore();
    }
  });

  it("doNotTrack lands on fakeWindow.navigator and defaults to '0'", () => {
    const dnt = setupFakeDom({ doNotTrack: "1" });
    try {
      assert.deepEqual(dnt.fakeWindow.navigator, { doNotTrack: "1" });
    } finally {
      dnt.restore();
    }
    const dflt = setupFakeDom();
    try {
      assert.deepEqual(dflt.fakeWindow.navigator, { doNotTrack: "0" });
    } finally {
      dflt.restore();
    }
  });

  it("records document listeners by type and drops them on removeEventListener", () => {
    const fake = setupFakeDom();
    try {
      const doc = g.document as {
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
      };
      const first = () => {};
      const second = () => {};
      doc.addEventListener("visibilitychange", first);
      doc.addEventListener("visibilitychange", second);
      assert.deepEqual(fake.listeners.visibilitychange, [first, second]);

      doc.removeEventListener("visibilitychange", first);
      assert.deepEqual(fake.listeners.visibilitychange, [second]);
      // A listener nobody registered is not an error — the real DOM ignores it,
      // and a cleanup that runs twice is the shape that would hit this.
      doc.removeEventListener("visibilitychange", first);
      doc.removeEventListener("nothing-registered", first);
      assert.deepEqual(fake.listeners.visibilitychange, [second]);
    } finally {
      fake.restore();
    }
  });

  it("setHidden flips document.hidden BEFORE the handlers read it", () => {
    // The ordering is the contract: a real browser has already changed the
    // flag by the time it dispatches, and a handler branching on
    // `document.hidden` is the only kind this event has.
    const fake = setupFakeDom();
    try {
      const doc = g.document as {
        hidden: boolean;
        addEventListener: (type: string, listener: () => void) => void;
      };
      const seen: boolean[] = [];
      doc.addEventListener("visibilitychange", () => seen.push(doc.hidden));

      fake.setHidden(true);
      fake.setHidden(false);

      assert.deepEqual(seen, [true, false]);
      assert.equal(doc.hidden, false);
    } finally {
      fake.restore();
    }
  });

  it("survives a handler that removes itself while the event is dispatching", () => {
    // Which is what an effect cleanup running inside a handler does. Walking
    // the live array here skips the next listener instead.
    const fake = setupFakeDom();
    try {
      const doc = g.document as {
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
      };
      const calls: string[] = [];
      const first = () => {
        calls.push("first");
        doc.removeEventListener("visibilitychange", first);
      };
      const second = () => calls.push("second");
      doc.addEventListener("visibilitychange", first);
      doc.addEventListener("visibilitychange", second);

      fake.setHidden(true);

      assert.deepEqual(calls, ["first", "second"]);
      assert.deepEqual(fake.listeners.visibilitychange, [second]);
    } finally {
      fake.restore();
    }
  });

  it("starts visible, which is the state a mounted tab is in", () => {
    const fake = setupFakeDom();
    try {
      assert.equal((g.document as { hidden: boolean }).hidden, false);
      assert.deepEqual(fake.listeners, {});
    } finally {
      fake.restore();
    }
  });

  it("clarity.test.ts consumes the shared helper instead of a local re-roll", () => {
    const source = readRepoFile("__tests__/clarity.test.ts");
    assert.match(source, /from "\.\/helpers\/fake-dom"/);
    assert.doesNotMatch(source, /function setupFakeDom/);
  });
});
