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
 *
 * The second surface is visibility: `document.hidden`, the listener registry
 * behind `addEventListener`/`removeEventListener`, and {@link FakeDom.setHidden}
 * which flips the flag and dispatches. It arrived with
 * `use-visibility-refresh.test.ts`, whose subject is a hook that pauses a poll
 * while the tab is away — a module that cannot be tested by inspecting what it
 * appended to `head`, only by being sent an event and asked what it did. The
 * registry is also the assertion for the OTHER half of that hook: a listener
 * still in `listeners.visibilitychange` after an unmount is a leak.
 */

export type FakeNode = {
  id?: string;
  parentNode?: FakeParent | null;
  tagName?: string;
  /**
   * What a live region is read from, and what `setAttribute` recorded.
   *
   * Both arrived with `reorder-announcement.web.ts`, whose whole subject is a
   * node's text and its `aria-live` attributes — a fake element without them
   * can be appended and inspected but says nothing about what a screen reader
   * would do with it.
   */
  textContent?: string;
  attributes?: Record<string, string>;
  style?: Record<string, string>;
  setAttribute?: (name: string, value: string) => void;
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
  /**
   * `document.body`, which a live region is appended to.
   *
   * Optional on the fake for the same reason it is optional in the shim: a
   * renderer that is not a browser may have a `document` and no `body`, and
   * `setupFakeDom({ hasBody: false })` is how a case asks for that one.
   */
  body: FakeParent | null;
  created: FakeNode[];
  byId: Record<string, FakeNode | null>;
  fakeWindow: Record<string, unknown>;
  /** Listeners registered on the document, by event type, in registration order. */
  listeners: Record<string, ((event: { type: string }) => void)[]>;
  /**
   * Flips `document.hidden` and fires `visibilitychange` at every listener.
   *
   * The pair is one call because they are one event: a hook reading
   * `document.hidden` inside its handler sees the value the browser had
   * already changed before it dispatched, and a test that set the flag after
   * dispatching would exercise a sequence no browser produces.
   */
  setHidden: (hidden: boolean) => void;
  restore: () => void;
};

export function setupFakeDom(opts?: {
  hasFirstScript?: boolean;
  hasBody?: boolean;
  doNotTrack?: unknown;
}): FakeDom {
  const parent = (): FakeParent => ({
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
  });
  const head = parent();
  const body: FakeParent | null = opts?.hasBody === false ? null : parent();
  const firstScript: FakeNode | null = opts?.hasFirstScript === false
    ? null
    : { tagName: "SCRIPT", parentNode: head };
  const created: FakeNode[] = [];
  const byId: Record<string, FakeNode | null> = {};

  const listeners: Record<string, ((event: { type: string }) => void)[]> = {};

  const fakeDocument = {
    head,
    body,
    /**
     * `document.hidden`, the flag a visibility handler branches on.
     *
     * Mutable rather than a constructor option because the interesting cases
     * are transitions: a tab that goes away and comes back, which is one
     * mount and two events.
     */
    hidden: false,
    addEventListener(type: string, listener: (event: { type: string }) => void) {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener(type: string, listener: (event: { type: string }) => void) {
      const forType = listeners[type];
      if (!forType) return;
      const at = forType.indexOf(listener);
      if (at >= 0) forType.splice(at, 1);
    },
    getElementById(id: string) {
      return byId[id] ?? null;
    },
    getElementsByTagName(_: string) {
      return firstScript ? [firstScript] : [];
    },
    createElement(tagName: string) {
      const attributes: Record<string, string> = {};
      const node: FakeNode & {
        id?: string;
        async?: boolean;
        src?: string;
      } = {
        tagName: tagName.toUpperCase(),
        textContent: "",
        attributes,
        style: {},
        setAttribute(name: string, value: string) {
          attributes[name] = value;
        },
      };
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
    body,
    created,
    byId,
    fakeWindow,
    listeners,
    setHidden(hidden: boolean) {
      fakeDocument.hidden = hidden;
      // A copy, because a handler that removes itself while the event is
      // dispatching would otherwise shorten the array being walked — which is
      // exactly what an effect cleanup running inside a handler does.
      for (const listener of [...(listeners.visibilitychange ?? [])]) {
        listener({ type: "visibilitychange" });
      }
    },
    restore() {
      if (prevWindow === undefined) delete g.window;
      else g.window = prevWindow;
      if (prevDocument === undefined) delete g.document;
      else g.document = prevDocument;
    },
  };
}
