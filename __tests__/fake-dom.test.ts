import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { setupFakeDom, type FakeNode } from "./helpers/fake-dom";

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

  it("clarity.test.ts consumes the shared helper instead of a local re-roll", () => {
    const source = readFileSync(
      path.join(process.cwd(), "__tests__", "clarity.test.ts"),
      "utf8",
    );
    assert.match(source, /from "\.\/helpers\/fake-dom"/);
    assert.doesNotMatch(source, /function setupFakeDom/);
  });
});
