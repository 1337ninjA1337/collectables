import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toastAnnouncement } from "@/lib/toast-announcement";
import { capToastStack, TOAST_STACK_MAX } from "@/lib/toast-stack";
import {
  nextToastDeadline,
  TOAST_ACTION_DISPLAY_MS,
  TOAST_DISPLAY_MS,
  TOAST_HOLD_MAX_WINDOWS,
  toastDisplayMs,
  toastHoldCeilingMs,
} from "@/lib/toast-timing";
import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeStrings } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * A toast that can be acted on, and the first thing that acts on it.
 *
 * Entering reorder mode used to explain why dragging was off; it clears the
 * sort now, which discards something the owner chose — so the toast that says
 * so has to be able to put it back. `toast-context.tsx` pulls React Native, so
 * the timing rule lives in its own module and everything else here is
 * structural.
 */
// The queue and the api are in `lib/toast-context.tsx`; the markup and the
// dismissal window moved to `components/toast-host.tsx` on 2026-09-14, so the
// a11y, clarity, empty-state and heading rules could see them at all.
const toastSrc = readRepoFile("components/toast-host.tsx");
const contextSrc = readRepoFile("lib/toast-context.tsx");
const screenSrc = readRepoFile("app/collection/[id].tsx");

describe("toastDisplayMs", () => {
  it("gives an actionable toast a longer window than a reporting one", () => {
    // An undo the user cannot reach in time is worse than no undo: it shows
    // them the way back and then takes it away.
    assert.equal(toastDisplayMs(false), TOAST_DISPLAY_MS);
    assert.equal(toastDisplayMs(true), TOAST_ACTION_DISPLAY_MS);
    assert.ok(TOAST_ACTION_DISPLAY_MS > TOAST_DISPLAY_MS);
  });

  it("keeps both windows in the range a human can actually use", () => {
    // Long enough to read a sentence; short enough that the toast is not
    // furniture. A regression to 800ms or 30s would pass every other check.
    assert.ok(TOAST_DISPLAY_MS >= 2500 && TOAST_DISPLAY_MS <= 5000);
    assert.ok(TOAST_ACTION_DISPLAY_MS >= 5000 && TOAST_ACTION_DISPLAY_MS <= 10000);
  });
});

describe("nextToastDeadline", () => {
  it("gives an unheld toast the full window, whichever window that is", () => {
    for (const hasAction of [false, true]) {
      assert.equal(
        nextToastDeadline({ held: false, hasAction, elapsedMs: 0 }),
        toastDisplayMs(hasAction),
      );
    }
  });

  it("restarts the FULL window on release, not the remainder", () => {
    // Deliberate: the user has just looked away from something they were
    // reading, and a 300ms stub would be indistinguishable from a toast that
    // ignored them. So elapsed time does not shorten an unheld window.
    assert.equal(
      nextToastDeadline({ held: false, hasAction: true, elapsedMs: 6000 }),
      TOAST_ACTION_DISPLAY_MS,
    );
  });

  it("gives a held toast what is left of the ceiling", () => {
    const ceiling = toastHoldCeilingMs(true);
    assert.equal(nextToastDeadline({ held: true, hasAction: true, elapsedMs: 0 }), ceiling);
    assert.equal(nextToastDeadline({ held: true, hasAction: true, elapsedMs: 1000 }), ceiling - 1000);
  });

  it("dismisses a toast held past the ceiling rather than never", () => {
    // The bug being fixed: `onHoverIn` with no `onHoverOut` to match it — a
    // drag that ended over the toast, a stuck hover on a phone — used to mean
    // no timer at all, and an overlay over the app for the rest of the session.
    for (const elapsed of [toastHoldCeilingMs(true), toastHoldCeilingMs(true) + 60_000]) {
      assert.equal(nextToastDeadline({ held: true, hasAction: true, elapsedMs: elapsed }), 0);
    }
  });

  it("never returns a negative delay, whatever the clock says", () => {
    // `setTimeout` treats a negative delay as zero, so this is not a crash —
    // it is the assertion that says so on purpose rather than by luck. A
    // system clock that stepped backwards is the way elapsed goes negative.
    for (const elapsed of [-1, -60_000]) {
      for (const held of [true, false]) {
        assert.ok(nextToastDeadline({ held, hasAction: false, elapsedMs: elapsed }) >= 0);
      }
    }
  });

  it("keeps the ceiling long enough to read and short enough to end", () => {
    // A ceiling under two windows would cut short a user who really is
    // reading; one in the minutes is the permanent banner with extra steps.
    assert.ok(TOAST_HOLD_MAX_WINDOWS >= 2 && TOAST_HOLD_MAX_WINDOWS <= 8);
    assert.ok(toastHoldCeilingMs(true) <= 60_000);
    assert.ok(toastHoldCeilingMs(true) > TOAST_ACTION_DISPLAY_MS);
    assert.ok(toastHoldCeilingMs(false) > TOAST_DISPLAY_MS);
  });
});

describe("capToastStack", () => {
  it("leaves a stack that fits alone, by identity", () => {
    // Identity and not just contents: a fresh array on every `show()` would
    // re-render every toast in the stack, restart their entrance animations
    // and reset the very timers the cap exists to bound.
    const two = [1, 2];
    assert.equal(capToastStack(two), two);
    const full = [1, 2, 3].slice(0, TOAST_STACK_MAX);
    assert.equal(capToastStack(full), full);
  });

  it("drops the OLDEST when a new toast arrives at a full stack", () => {
    // The direction is the whole decision: the newest toast describes what
    // just happened and is the only one whose action is still what the user
    // is reaching for.
    const queued = Array.from({ length: TOAST_STACK_MAX + 2 }, (_, i) => i + 1);
    const kept = capToastStack(queued);
    assert.equal(kept.length, TOAST_STACK_MAX);
    assert.deepEqual(kept, queued.slice(queued.length - TOAST_STACK_MAX));
    assert.equal(kept[kept.length - 1], queued[queued.length - 1]);
  });

  it("caps a burst of many at the depth, not at some multiple of it", () => {
    // The failure that produced this: a loop that toasts per failed row.
    assert.equal(capToastStack(Array.from({ length: 200 }, (_, i) => i)).length, TOAST_STACK_MAX);
  });

  it("takes an explicit depth, and reads a nonsensical one as empty", () => {
    assert.deepEqual(capToastStack([1, 2, 3], 1), [3]);
    assert.deepEqual(capToastStack([1, 2, 3], 0), []);
    assert.deepEqual(capToastStack([1, 2, 3], -4), []);
  });

  it("keeps the depth small enough to stay a notice rather than a screen", () => {
    assert.ok(TOAST_STACK_MAX >= 2 && TOAST_STACK_MAX <= 5);
  });
});

describe("the provider caps its own queue", () => {
  it("routes every queued toast through the cap", () => {
    // The append was unbounded until 2026-09-17; nothing removed an entry but
    // its own dismissal timer, and a held toast has no timer running.
    assert.match(contextSrc, /setToasts\(\(current\) => capToastStack\(\[\.\.\.current, item\]\)\);/);
    assert.doesNotMatch(
      contextSrc,
      /setToasts\(\(current\) => \[\.\.\.current, item\]\)/,
      "the uncapped append came back",
    );
  });
});

describe("the toast renders and times its action", () => {
  it("takes the window from the shared rule rather than a literal", () => {
    // The decision itself is `nextToastDeadline`, asserted by being called
    // above; what stays here is that the view ASKS it rather than growing a
    // second copy of the numbers.
    assert.match(toastSrc, /nextToastDeadline\(\{ held, hasAction: !!toast\.action/);
    assert.doesNotMatch(toastSrc, /const DISPLAY_MS = \d+/, "the timing literal came back");
    assert.doesNotMatch(toastSrc, /toastDisplayMs\(/, "the view decides the window again");
  });

  it("holds the window open while the user is engaged with the toast", () => {
    // An undo that expires under the cursor reaching for it is the failure
    // this prevents; focus counts as engagement for the same reason. What the
    // hold DOES to the timer is in toast-host-render.test.ts; this is only
    // that both surfaces are wired to it.
    assert.match(toastSrc, /const hold = \(\) => setHeld\(true\);/);
    assert.match(toastSrc, /const release = \(\) => setHeld\(false\);/);
    const action = toastSrc.match(/\{toast\.action \? \([\s\S]*?\) : null\}/)?.[0] ?? "";
    for (const prop of ["onHoverIn={hold}", "onHoverOut={release}", "onFocus={hold}", "onBlur={release}"]) {
      assert.ok(action.includes(prop), `the action must wire ${prop}`);
    }
  });

  it("times each toast from the view, not from the provider", () => {
    // A timer owned by `show()` cannot be paused by the toast it is counting
    // down, and the identity of the per-toast dismiss handler must not restart
    // it either — hence the ref.
    assert.doesNotMatch(toastSrc, /setTimeout\([^)]*dismiss\(id\)/);
    assert.match(toastSrc, /const dismissRef = useRef\(onDismiss\);/);
    assert.match(toastSrc, /\}, \[held, toast\.action\]\);/);
  });

  it("measures the ceiling from when the toast appeared, not from the last hover", () => {
    // A `shownAt` recomputed on each re-run would reset the ceiling on every
    // hover, which is the unbounded life this was written to end — so the
    // timestamp is a ref, captured once.
    assert.match(toastSrc, /const shownAt = useRef\(Date\.now\(\)\);/);
    assert.match(toastSrc, /elapsedMs: Date\.now\(\) - shownAt\.current/);
  });

  it("renders the action only when there is one", () => {
    assert.match(toastSrc, /\{toast\.action \? \(/);
  });

  it("gives the action a button role and its label to a screen reader", () => {
    const action = toastSrc.match(/\{toast\.action \? \([\s\S]*?\) : null\}/)?.[0] ?? "";
    assert.ok(action.length > 0, "expected to extract the action block");
    assert.match(action, /accessibilityRole="button"/);
    assert.match(action, /accessibilityLabel=\{toast\.action\.label\}/);
  });

  it("dismisses the toast after running the action, not before", () => {
    // A toast left standing invites a second press on an undo that already
    // happened; dismissing first would swallow a handler that threw.
    const action = toastSrc.match(/\{toast\.action \? \([\s\S]*?\) : null\}/)?.[0] ?? "";
    const order = action.indexOf("toast.action?.onPress()");
    const dismiss = action.indexOf("onDismiss()");
    assert.ok(order > 0 && dismiss > order, "onPress must run before onDismiss");
  });

  it("takes a translated label, not a key", () => {
    // The module sits below the i18n context and every other string it renders
    // arrives the same way.
    assert.match(contextSrc, /export type ToastAction = \{ label: string; onPress: \(\) => void \};/);
    assert.doesNotMatch(toastSrc, /useI18n/);
  });
});

describe("toastAnnouncement", () => {
  it("joins a title and a message into one sentence", () => {
    assert.equal(
      toastAnnouncement({ title: "Saved", message: "Your changes are synced." }),
      "Saved. Your changes are synced.",
    );
  });

  it("does not give a title that punctuates itself a second period", () => {
    for (const title of ["Saved.", "Saved!", "Really?", "Note:", "Wait;"]) {
      const spoken = toastAnnouncement({ title, message: "Done." }) ?? "";
      assert.equal(spoken, `${title} Done.`, `double-punctuated after ${title}`);
    }
  });

  it("speaks either half alone", () => {
    assert.equal(toastAnnouncement({ message: "Done." }), "Done.");
    assert.equal(toastAnnouncement({ title: "Saved", message: "" }), "Saved");
    assert.equal(toastAnnouncement({ title: "  ", message: " Done. " }), "Done.");
  });

  it("says nothing rather than an empty sentence", () => {
    // A live region written with "" is a change a reader may still announce as
    // silence-with-a-pause; there is nothing here to say.
    assert.equal(toastAnnouncement({ message: "" }), null);
    assert.equal(toastAnnouncement({ title: "   ", message: "  " }), null);
  });

  it("leaves the action label out of the sentence", () => {
    // "Undo" read aloud with no way to say how to reach the button is a worse
    // sentence than the message alone.
    assert.equal(toastAnnouncement({ message: "Sort cleared." }), "Sort cleared.");
  });
});

describe("every toast announces itself", () => {
  it("derives the sentence from the toast and speaks it once, in the provider", () => {
    // The announcement is the PROVIDER's, not the overlay's: it fires when a
    // toast is queued, whether or not the host ever draws it.
    assert.match(contextSrc, /const spoken = toastAnnouncement\(item\);/);
    assert.match(contextSrc, /if \(spoken\) announceMessage\(spoken\);/);
  });

  it("speaks through the app's one live region", () => {
    // A second region would interrupt the reorder announcements and the user
    // would hear half of each — see lib/announce.web.ts.
    assert.match(contextSrc, /import \{ announceMessage \} from "@\/lib\/announce";/);
    assert.doesNotMatch(toastSrc, /aria-live/);
  });
});

describe("entering reorder mode clears the sort", () => {
  it("clears only when entering, and only when a sort is on", () => {
    // Leaving the mode must not touch the sort, and entering it with no sort
    // must not toast about nothing.
    const decl = screenSrc.match(/const toggleReorderMode = useCallback\([\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] ?? "";
    assert.ok(decl.length > 0, "expected to extract the toggleReorderMode declaration");
    assert.match(decl, /const entering = !reorderMode;/);
    assert.match(decl, /if \(!entering \|\| itemFilters\.sort === "default"\) return;/);
  });

  it("offers the cleared sort back through the toast's action", () => {
    const decl = screenSrc.match(/const toggleReorderMode = useCallback\([\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] ?? "";
    assert.match(decl, /const previous = itemFilters\.sort;/);
    assert.match(decl, /applySort\("default"\);/);
    assert.match(decl, /label: t\("undo"\),/);
    assert.match(decl, /applySort\(previous\);/);
  });

  it("says the undo out loud, and leaves the clear to the toast", () => {
    // The clear rides in a toast, and every toast announces itself now — a
    // hand-written call beside it would say the same sentence twice. The undo
    // shows no toast at all, so it keeps its own.
    const decl = screenSrc.match(/const toggleReorderMode = useCallback\([\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] ?? "";
    assert.match(decl, /announceMessage\(t\("sortRestored"\)\);/);
    assert.doesNotMatch(
      decl,
      /announceMessage\(t\("sortClearedForReorder"\)\)/,
      "the toast already announces its own message",
    );
  });

  it("keeps the notice for the case it was written for", () => {
    // A sort applied WHILE reorder mode is already on still needs explaining —
    // the handoff only covers the way in.
    assert.match(screenSrc, /reorderMode\s*&&\s*\n\s*itemFilters\.sort !== "default";/);
    assert.match(screenSrc, /t\("reorderBlockedBySort"\)/);
  });
});

describe("the handoff's strings", () => {
  const KEYS = ["sortClearedForReorder", "undo", "sortRestored"] as const;

  it("declares both keys in every locale", () => {
    const src = readI18nSource();
    for (const key of KEYS) assertDeclaredInEveryLocale(src, key);
  });

  it("translates each rather than copying the English six times", () => {
    const src = readI18nSource();
    for (const key of KEYS) {
      const values = localeStrings(src, key);
      assert.equal(
        new Set(values.values()).size,
        values.size,
        `${key} repeats a string across locales`,
      );
    }
  });
});
