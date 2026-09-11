/**
 * The announcement that was silent on the only platform this app deploys to.
 *
 * `lib/announce.ts` calls `AccessibilityInfo.announceForAccessibility`, which
 * iOS and Android implement and react-native-web does not: its version is
 * `announceForAccessibility: function (announcement) {}`, an empty function.
 * So the reorder announcements shipped, passed their suite, and did nothing on
 * GitHub Pages.
 *
 * `lib/announce.web.ts` is the spelling Metro serves the web bundle — same
 * signature, an ARIA live region instead of a no-op. What these cases are about
 * is the three ways a live region is silently wrong: it was not in the document
 * before the text changed, it was hidden in a way that removes it from the
 * accessibility tree, or the text did not actually change. None of those is
 * visible by reading the code, and none of them errors.
 *
 * WHAT MOVED OUT OF HERE. These used to be reorder cases, calling
 * `announceReorder` with an index and a total and asserting a position was or
 * was not read aloud. The mechanism is a general one now — one region, one
 * `announceMessage`, with reordering as its first caller — so the silences that
 * belong to `announcedPosition` are asserted where that function lives
 * (`reorder-announcement.test.ts`, which runs it directly) and what is left
 * here is the region: the part only a DOM can answer.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  __resetAnnouncementsForTests,
  announceMessage,
  ensureLiveRegion,
} from "@/lib/announce.web";
import { ANNOUNCEMENT_HOLD_MS } from "@/lib/announce-queue";
import { setupFakeDom, type FakeDom, type FakeNode } from "./helpers/fake-dom";
import { readRepoFile } from "./helpers/repo-file";

const REGION_ID = "collectables-live-region";

/** A sentence of the shape the app actually announces. */
const MESSAGE = "Moved to position 3 of 7";

/** Lets the queued write land — the module writes the text in a later task. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Long enough for a held sentence to hand the channel to the next one. */
const afterHold = () => new Promise((resolve) => setTimeout(resolve, ANNOUNCEMENT_HOLD_MS + 10));

/**
 * Runs a case against a fresh fake DOM, and puts the real globals back.
 *
 * The module finds its region through `document.getElementById` every time, so
 * swapping the document out is most of the setup. What it does hold between
 * calls is the announcement channel — one sentence at a time, the rest in a
 * pending slot — and that survives the document it was speaking into: without
 * the reset a case that announces arms a timer which fires into the NEXT
 * case's fake DOM, writing a sentence nobody asked for into a region that
 * should be empty. Reset on both sides, because a case can leave one pending
 * as easily as it can inherit one.
 */
async function withDom(
  run: (dom: FakeDom) => Promise<void>,
  opts?: { hasBody?: boolean },
): Promise<void> {
  __resetAnnouncementsForTests();
  const dom = setupFakeDom(opts);
  try {
    await run(dom);
  } finally {
    __resetAnnouncementsForTests();
    dom.restore();
  }
}

/** The live region the module appended, or null when it appended nothing. */
function region(dom: FakeDom): FakeNode | null {
  return dom.body?.appended.find((node) => node.id === REGION_ID) ?? null;
}

describe("the web live region — how it is built", () => {
  it("appends one region to the body and finds it again", async () => {
    await withDom(async (dom) => {
      announceMessage(MESSAGE);
      announceMessage("Picked up");
      assert.equal(dom.body?.appended.length, 1, "a second announcement built a second region");
      assert.equal(region(dom)?.id, REGION_ID);
    });
  });

  it("is announced assertively and as a whole sentence", async () => {
    // Polite would queue: three quick keyboard moves and the user hears the
    // position they were at three presses ago. Non-atomic would let a reader
    // announce only the digit that changed.
    await withDom(async (dom) => {
      announceMessage(MESSAGE);
      assert.equal(region(dom)?.attributes?.["aria-live"], "assertive");
      assert.equal(region(dom)?.attributes?.["aria-atomic"], "true");
    });
  });

  it("hides the region without leaving the accessibility tree", async () => {
    // The failure this is here for: `display: none` and `visibility: hidden`
    // both hide it from a screen reader too, which is a region that announces
    // nothing and looks correct.
    await withDom(async (dom) => {
      announceMessage(MESSAGE);
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
    await withDom(async (dom) => {
      announceMessage(MESSAGE);
      assert.equal(region(dom)?.textContent, "", "the region carried its text before it was in the document");
      await settle();
      assert.equal(region(dom)?.textContent, MESSAGE);
    });
  });
});

describe("the web live region — what it says", () => {
  it("reads the sentence it was handed, whole", async () => {
    await withDom(async (dom) => {
      announceMessage("Picked up Alpha");
      await settle();
      assert.equal(region(dom)?.textContent, "Picked up Alpha");
    });
  });

  it("clears before each write, so the same sentence twice is heard twice", async () => {
    // An unchanged string is not a mutation and is not announced. Clearing is
    // what makes a repeat land — reachable when a drag ends where it started
    // and the user then presses the same key.
    await withDom(async (dom) => {
      announceMessage(MESSAGE);
      await settle();
      assert.equal(region(dom)?.textContent, MESSAGE);
      await afterHold();
      announceMessage(MESSAGE);
      assert.equal(region(dom)?.textContent, "", "the second announcement did not clear the region first");
      await settle();
      assert.equal(region(dom)?.textContent, MESSAGE);
    });
  });

  it("says both sentences when two callers announce in one tick", async () => {
    // This used to keep only the last: both writes landed on one node inside
    // one task, so a reader observed a single mutation and read a single
    // sentence. A toast arriving in the same tick as a keyboard move silenced
    // the move, and nothing said so.
    await withDom(async (dom) => {
      announceMessage("Picked up");
      announceMessage(MESSAGE);

      await settle();
      assert.equal(region(dom)?.textContent, "Picked up", "the first caller is heard first");

      await afterHold();
      assert.equal(region(dom)?.textContent, MESSAGE, "and the second is heard after it");
    });
  });

  it("keeps the newest of several sentences waiting on the channel", async () => {
    // Five keyboard moves in a second: the user hears where they started and
    // where they are. The three in the middle were stale before they could be
    // read aloud, and reading them all would put the user a second behind
    // their own hands.
    await withDom(async (dom) => {
      announceMessage("position 1 of 5");
      announceMessage("position 2 of 5");
      announceMessage("position 3 of 5");
      announceMessage("position 4 of 5");

      await settle();
      assert.equal(region(dom)?.textContent, "position 1 of 5");

      await afterHold();
      assert.equal(region(dom)?.textContent, "position 4 of 5");

      await afterHold();
      assert.equal(region(dom)?.textContent, "position 4 of 5", "and nothing is left over");
    });
  });
});

describe("the web live region — when it stays quiet", () => {
  it("does nothing where the document has no body", async () => {
    // A prerender pass, or any renderer that is not a browser. An announcement
    // is not worth a TypeError inside an event handler.
    await withDom(
      async (dom) => {
        announceMessage(MESSAGE);
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
      assert.doesNotThrow(() => announceMessage(MESSAGE));
    } finally {
      if (previous === undefined) delete g.document;
      else g.document = previous;
    }
  });
});

describe("the region is mounted before anything has to be announced", () => {
  /**
   * The one silence the clear-then-write cannot cover.
   *
   * Staging the text in a later task makes the region's own content a
   * MUTATION, which is what a live region announces. It does not help a reader
   * that has not yet scanned the subtree the region was just appended to —
   * there is nothing to mutate from its point of view. The only fix is for the
   * node to have been there first, which is a startup concern.
   */
  it("appends an empty region with no announcement at all", async () => {
    await withDom(async (dom) => {
      ensureLiveRegion();
      assert.equal(dom.body?.appended.length, 1);
      assert.equal(region(dom)?.textContent, "");
      assert.equal(region(dom)?.attributes?.["aria-live"], "assertive");
      assert.equal(region(dom)?.attributes?.["aria-atomic"], "true");
      // Nothing queued: a mount that scheduled a write would announce an empty
      // string at startup, which some readers speak as a pause.
      await settle();
      assert.equal(region(dom)?.textContent, "");
    });
  });

  it("is idempotent, which is what makes it safe to call from an effect", async () => {
    // React runs an effect twice in StrictMode, and a remount runs it again.
    await withDom(async (dom) => {
      ensureLiveRegion();
      ensureLiveRegion();
      ensureLiveRegion();
      assert.equal(dom.body?.appended.length, 1, "each call appended its own region");
    });
  });

  it("hands the mounted region to the first announcement rather than replacing it", async () => {
    // The point of mounting early: the FIRST announcement writes into a node
    // the reader has already seen, instead of into one that arrives with it.
    await withDom(async (dom) => {
      ensureLiveRegion();
      const mounted = region(dom);
      announceMessage(MESSAGE);
      await settle();
      assert.equal(dom.body?.appended.length, 1, "the announcement built a second region");
      assert.equal(mounted?.textContent, MESSAGE);
    });
  });

  it("does nothing where there is no body, and nothing where there is no document", async () => {
    // It runs from a root-layout effect, so every renderer that mounts the
    // tree reaches it — including a prerender pass with no DOM. A throw there
    // is a blank app, not a missing announcement.
    await withDom(
      async () => {
        assert.doesNotThrow(() => ensureLiveRegion());
      },
      { hasBody: false },
    );
    const g = globalThis as { document?: unknown };
    const previous = g.document;
    delete g.document;
    try {
      assert.doesNotThrow(() => ensureLiveRegion());
    } finally {
      if (previous === undefined) delete g.document;
      else g.document = previous;
    }
  });
});

describe("the two spellings", () => {
  it("names the react-native-web no-op that made the web spelling necessary", () => {
    // Without this, the file reads as gratuitous: react-native ALREADY has an
    // announcement API, and the reason it cannot be used here is one line in
    // somebody else's node_modules.
    const web = readRepoFile("lib/announce.web.ts");
    assert.match(web, /announceForAccessibility/);
    assert.match(web, /react-native-web/);
  });

  it("keeps the platform split in the door and not in its callers", () => {
    // `lib/reorder-announcement.ts` used to have a `.web` spelling of its own,
    // and the only thing that differed between the two was the mechanism. It
    // has none now: it imports the door and holds the decision.
    const caller = readRepoFile("lib/reorder-announcement.ts");
    assert.match(caller, /import \{ announceMessage \} from "@\/lib\/announce";/);
    assert.doesNotMatch(caller, /AccessibilityInfo/);
    assert.doesNotMatch(caller, /document/);
  });

  it("is one region for the app, not one per caller", () => {
    // Two assertive regions interrupt each other and the user hears half of
    // each — which is what a second caller adding its own would produce.
    const web = readRepoFile("lib/announce.web.ts");
    const ids = [...web.matchAll(/aria-live/g)];
    assert.equal(ids.length, 1, "more than one live region is declared here");
    assert.match(web, /const REGION_ID = "collectables-live-region";/);
  });
});
