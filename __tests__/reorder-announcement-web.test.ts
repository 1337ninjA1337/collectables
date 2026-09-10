/**
 * The announcement that was silent on the only platform this app deploys to.
 *
 * `lib/reorder-announcement.ts` calls `AccessibilityInfo.announceForAccessibility`,
 * which iOS and Android implement and react-native-web does not: its version is
 * `announceForAccessibility: function (announcement) {}`, an empty function.
 * So the reorder announcements shipped, passed their suite, and did nothing on
 * GitHub Pages.
 *
 * `lib/reorder-announcement.web.ts` is the spelling Metro serves the web bundle
 * — same signature, same silences, an ARIA live region instead of a no-op. What
 * these cases are about is the three ways a live region is silently wrong: it
 * was not in the document before the text changed, it was hidden in a way that
 * removes it from the accessibility tree, or the text did not actually change.
 * None of those is visible by reading the code, and none of them errors.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { announceReorder } from "@/lib/reorder-announcement.web";
import { setupFakeDom, type FakeDom, type FakeNode } from "./helpers/fake-dom";
import { readRepoFile } from "./helpers/repo-file";

const REGION_ID = "collectables-reorder-live-region";

/** A `t` that shows what it was given, so a case can assert both halves. */
const t = (key: string, params?: Record<string, string | number>) =>
  `${key}:${params?.position}/${params?.total}`;

/** Lets the queued write land — the module writes the text in a later task. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Runs a case against a fresh fake DOM, and puts the real globals back.
 *
 * The module under test holds no state between calls — it finds its region
 * through `document.getElementById` every time — so one import serves every
 * case, and swapping the document out from under it is the whole setup.
 */
async function withDom(
  run: (announce: typeof announceReorder, dom: FakeDom) => Promise<void>,
  opts?: { hasBody?: boolean },
): Promise<void> {
  const dom = setupFakeDom(opts);
  try {
    await run(announceReorder, dom);
  } finally {
    dom.restore();
  }
}

/** The live region the module appended, or null when it appended nothing. */
function region(dom: FakeDom): FakeNode | null {
  return dom.body?.appended.find((node) => node.id === REGION_ID) ?? null;
}

describe("the web live region — how it is built", () => {
  it("appends one region to the body and finds it again", async () => {
    await withDom(async (announce, dom) => {
      announce(t, "reorderMoved", 2, 7);
      announce(t, "reorderPickedUp", 0, 7);
      assert.equal(dom.body?.appended.length, 1, "a second announcement built a second region");
      assert.equal(region(dom)?.id, REGION_ID);
    });
  });

  it("is announced assertively and as a whole sentence", async () => {
    // Polite would queue: three quick keyboard moves and the user hears the
    // position they were at three presses ago. Non-atomic would let a reader
    // announce only the digit that changed.
    await withDom(async (announce, dom) => {
      announce(t, "reorderMoved", 2, 7);
      assert.equal(region(dom)?.attributes?.["aria-live"], "assertive");
      assert.equal(region(dom)?.attributes?.["aria-atomic"], "true");
    });
  });

  it("hides the region without leaving the accessibility tree", async () => {
    // The failure this is here for: `display: none` and `visibility: hidden`
    // both hide it from a screen reader too, which is a region that announces
    // nothing and looks correct.
    await withDom(async (announce, dom) => {
      announce(t, "reorderMoved", 2, 7);
      const style = region(dom)?.style ?? {};
      assert.equal(style.display, undefined, "the region was display:none — it would be unreadable");
      assert.equal(style.visibility, undefined, "the region was visibility:hidden — it would be unreadable");
      assert.equal(style.position, "absolute");
      assert.equal(style.clip, "rect(0 0 0 0)");
      assert.equal(style.width, "1px");
    });
  });

  it("is created empty and written to afterwards", async () => {
    // A region whose text is set in the same task it was appended in has not
    // been observed yet, so the change is not announced. This is the ordering
    // that makes the FIRST announcement work.
    await withDom(async (announce, dom) => {
      announce(t, "reorderMoved", 2, 7);
      assert.equal(region(dom)?.textContent, "", "the region carried its text before it was in the document");
      await settle();
      assert.equal(region(dom)?.textContent, "reorderMoved:3/7");
    });
  });
});

describe("the web live region — what it says", () => {
  it("says the 1-based position and the total, through `t`", async () => {
    await withDom(async (announce, dom) => {
      announce(t, "reorderPickedUp", 0, 4);
      await settle();
      assert.equal(region(dom)?.textContent, "reorderPickedUp:1/4");
    });
  });

  it("clears before each write, so the same sentence twice is heard twice", async () => {
    // An unchanged string is not a mutation and is not announced. Clearing is
    // what makes a repeat land — reachable when a drag ends where it started
    // and the user then presses the same key.
    await withDom(async (announce, dom) => {
      announce(t, "reorderMoved", 2, 7);
      await settle();
      assert.equal(region(dom)?.textContent, "reorderMoved:3/7");
      announce(t, "reorderMoved", 2, 7);
      assert.equal(region(dom)?.textContent, "", "the second announcement did not clear the region first");
      await settle();
      assert.equal(region(dom)?.textContent, "reorderMoved:3/7");
    });
  });

  it("keeps the last message when two announcements race", async () => {
    await withDom(async (announce, dom) => {
      announce(t, "reorderPickedUp", 0, 7);
      announce(t, "reorderMoved", 3, 7);
      await settle();
      assert.equal(region(dom)?.textContent, "reorderMoved:4/7");
    });
  });
});

describe("the web live region — when it stays quiet", () => {
  it("says nothing, and builds nothing, when the position is untrustworthy", async () => {
    // Same silences as the native spelling: it shares `announcedPosition`
    // rather than re-deciding. A region built for an announcement that never
    // comes is a stray node in everybody's DOM.
    await withDom(async (announce, dom) => {
      announce(t, "reorderMoved", undefined, 7);
      announce(t, "reorderMoved", 7, 7);
      announce(t, "reorderMoved", -1, 7);
      announce(t, "reorderMoved", 0, 0);
      await settle();
      assert.equal(dom.body?.appended.length, 0);
    });
  });

  it("does nothing where the document has no body", async () => {
    // A prerender pass, or any renderer that is not a browser. An announcement
    // is not worth a TypeError inside an event handler.
    await withDom(
      async (announce, dom) => {
        announce(t, "reorderMoved", 2, 7);
        await settle();
        assert.equal(dom.body, null);
      },
      { hasBody: false },
    );
  });

  it("does nothing where there is no document at all", async () => {
    const g = globalThis as { document?: unknown };
    const previous = g.document;
    delete g.document;
    try {
      assert.doesNotThrow(() => announceReorder(t, "reorderMoved", 2, 7));
    } finally {
      if (previous === undefined) delete g.document;
      else g.document = previous;
    }
  });
});

describe("the two spellings agree", () => {
  it("export the same function name and the same key type", () => {
    const web = readRepoFile("lib/reorder-announcement.web.ts");
    const native = readRepoFile("lib/reorder-announcement.ts");
    for (const src of [web, native]) {
      assert.match(src, /export function announceReorder\(/);
    }
    // One definition of the two keys, re-exported rather than restated: a web
    // spelling that grew a third key its translations do not have would be a
    // sentence nobody hears.
    assert.match(native, /export type ReorderAnnouncement = "reorderPickedUp" \| "reorderMoved";/);
    assert.match(web, /export type \{ ReorderAnnouncement \} from "@\/lib\/reorder-announcement";/);
  });

  it("share the decision about whether to speak", () => {
    // `announcedPosition` is imported by both. Two copies of "is this position
    // sayable" is how one platform starts announcing a position the other
    // suppresses.
    for (const file of ["lib/reorder-announcement.ts", "lib/reorder-announcement.web.ts"]) {
      const src = readRepoFile(file);
      assert.match(src, /import \{ announcedPosition \} from "@\/lib\/drag-reorder";/, file);
      assert.match(src, /const at = announcedPosition\(index, total\);\n\s*if \(!at\) return;/, file);
    }
  });

  it("names the react-native-web no-op that made the web spelling necessary", () => {
    // Without this, the file reads as gratuitous: react-native ALREADY has an
    // announcement API, and the reason it cannot be used here is one line in
    // somebody else's node_modules.
    const web = readRepoFile("lib/reorder-announcement.web.ts");
    assert.match(web, /announceForAccessibility/);
    assert.match(web, /react-native-web/);
  });
});
