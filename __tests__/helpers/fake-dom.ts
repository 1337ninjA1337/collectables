/**
 * Minimal fake `document`/`window` stub for node-run tests of web-only
 * modules (Clarity script injection today; any future Plausible/GA4 wiring,
 * OpenGraph meta-tag injection, or service-worker registration tests).
 *
 * Promoted from `__tests__/clarity.test.ts` so each web-only module doesn't
 * re-invent the parentNode / getElementById / createElement mocks. Lives
 * under `__tests__/helpers/` — outside the `__tests__/*.test.ts` runner glob,
 * so it's a library, not a suite.
 *
 * `setupFakeDom()` swaps `globalThis.window`/`document` for fakes and returns
 * inspection handles plus a `restore()` that reinstates the previous globals —
 * ALWAYS call it (use try/finally or afterEach) or later tests inherit the
 * fake DOM.
 */

export type FakeNode = {
  id?: string;
  parentNode?: FakeParent | null;
  tagName?: string;
};

export type FakeParent = {
  removed: FakeNode[];
  inserted: { node: FakeNode; before: FakeNode | null }[];
  appended: FakeNode[];
  removeChild: (node: FakeNode) => void;
  insertBefore: (node: FakeNode, ref: FakeNode | null) => void;
  appendChild: (node: FakeNode) => void;
};

export type FakeDom = {
  head: FakeParent;
  created: FakeNode[];
  byId: Record<string, FakeNode | null>;
  fakeWindow: Record<string, unknown>;
  restore: () => void;
};

export function setupFakeDom(opts?: {
  hasFirstScript?: boolean;
  doNotTrack?: unknown;
}): FakeDom {
  const head: FakeParent = {
    removed: [],
    inserted: [],
    appended: [],
    removeChild(node) {
      this.removed.push(node);
      node.parentNode = null;
    },
    insertBefore(node, ref) {
      this.inserted.push({ node, before: ref });
      node.parentNode = this;
    },
    appendChild(node) {
      this.appended.push(node);
      node.parentNode = this;
    },
  };
  const firstScript: FakeNode | null = opts?.hasFirstScript === false
    ? null
    : { tagName: "SCRIPT", parentNode: head };
  const created: FakeNode[] = [];
  const byId: Record<string, FakeNode | null> = {};

  const fakeDocument = {
    head,
    getElementById(id: string) {
      return byId[id] ?? null;
    },
    getElementsByTagName(_: string) {
      return firstScript ? [firstScript] : [];
    },
    createElement(_: string) {
      const node: FakeNode & {
        id?: string;
        async?: boolean;
        src?: string;
      } = {};
      created.push(node);
      // Simulate the side-effect of setting id: register it in the byId map.
      Object.defineProperty(node, "id", {
        configurable: true,
        get() {
          return (this as { _id?: string })._id;
        },
        set(value: string) {
          (this as { _id?: string })._id = value;
          byId[value] = node as FakeNode;
        },
      });
      return node;
    },
  };

  const fakeWindow: Record<string, unknown> = {
    navigator: { doNotTrack: opts?.doNotTrack ?? "0" },
  };

  const g = globalThis as unknown as {
    window?: unknown;
    document?: unknown;
  };
  const prevWindow = g.window;
  const prevDocument = g.document;
  g.window = fakeWindow;
  g.document = fakeDocument;

  return {
    head,
    created,
    byId,
    fakeWindow,
    restore() {
      if (prevWindow === undefined) delete g.window;
      else g.window = prevWindow;
      if (prevDocument === undefined) delete g.document;
      else g.document = prevDocument;
    },
  };
}
