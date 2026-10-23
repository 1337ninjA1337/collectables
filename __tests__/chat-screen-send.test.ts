import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * `app/chat/[id].tsx`, read for the first time — the largest unread surface
 * left after the friends screen.
 *
 * Two defects, and both are about a press or a keystroke being taken as news
 * more than once: the composer could send one message twice, and the typing
 * indicator told the other side the same thing once per character.
 *
 * Source reads rather than a render: this screen reaches expo-router, three
 * contexts, `AppState`, a realtime presence channel and a `KeyboardAvoidingView`,
 * and nothing in this tree mounts it. Each case names the behaviour it stands
 * in for.
 */
const CODE = stripComments(readRepoFile("app/chat/[id].tsx"));
const REALTIME = stripComments(readRepoFile("lib/supabase-chat.ts"));

describe("one press, one message", () => {
  // `sendMessage` awaits a cloud insert before anything clears the box, and
  // `disabled={!text.trim()}` is false for that whole round trip — so a second
  // tap, or `onSubmitEditing` landing on top of the press that triggered it,
  // sent the same text again under a fresh uuid: two rows, two bubbles, and
  // nothing after the fact able to tell them from a message sent twice on
  // purpose.
  it("refuses a second send while the first is in flight", () => {
    assert.match(CODE, /const sendingRef = useRef\(false\);/);
    assert.match(
      CODE,
      /if \(!text\.trim\(\)\) return;\s*if \(sendingRef\.current\) return;\s*sendingRef\.current = true;/,
      "the guard has to be read and set before the first await",
    );
  });

  it("releases the guard in a finally, so a rejection cannot wedge the composer", () => {
    assert.match(
      CODE,
      /\} finally \{\s*sendingRef\.current = false;\s*if \(mountedRef\.current\) setSending\(false\);\s*\}/,
      "the ref is what the next press reads, so it is released first and unconditionally",
    );
  });

  it("keeps both entry points, because both are how people send a message", () => {
    // The keyboard's send key and the button, each still wired — the fix is
    // the guard, not removing one of them.
    assert.match(CODE, /onSubmitEditing=\{handleSend\}/);
    assert.match(CODE, /onPress=\{handleSend\}/);
  });

  it("blocks the press on the ref, never on the state", () => {
    // The second press is in the same tick as the first; a `setState` has not
    // re-rendered when it arrives. Same reason as `hasAttemptedShareSaveRef`.
    //
    // A `sending` STATE exists since 2026-10-23 — it dims the button for the
    // round trip the guard spends ignoring presses — and the claim this case
    // used to make ("no such state exists") was a proxy for the one that
    // matters: the early return reads the ref. A state in the guard's position
    // would let a double tap through.
    assert.match(CODE, /if \(sendingRef\.current\) return;/);
    assert.ok(
      !/if \(sending\) return;/.test(CODE),
      "state cannot block a press that arrives before the re-render",
    );
  });
});

describe("a keystroke is not news twice", () => {
  // `handleTextChange` debounces the STOP and not the start, so
  // `setTyping(true)` ran per character. Each call reached `channel.track()`:
  // a presence push per keystroke, each re-broadcasting the channel's
  // presence, each landing on the other side as a `sync` that re-renders
  // their conversation. Forty characters were forty pushes to say one thing.
  it("tracks presence only when the typing state actually changes", () => {
    assert.match(
      REALTIME,
      /const unchanged = isTyping === pendingTyping;\s*pendingTyping = isTyping;\s*if \(!channel \|\| !subscribed\) return;\s*if \(unchanged\) return;\s*void channel\.track\(\{ typing: isTyping \}\);/,
    );
  });

  it("records the latest intent even when it pushes nothing", () => {
    // `pendingTyping` is what the `subscribe` callback tracks when the channel
    // connects or reconnects, so the assignment stays ahead of both returns.
    assert.match(REALTIME, /void channel\?\.track\(\{ typing: pendingTyping \}\);/);
  });

  it("leaves the screen's debounce where it is", () => {
    // The stop is still a 1s trailing timer in the screen, cleared on send, on
    // an emptied box, on unmount and on backgrounding. The dedupe is about how
    // often the START is broadcast, and it belongs to the subscription because
    // every caller of it has the same question.
    assert.match(CODE, /const TYPING_DEBOUNCE_MS = 1000;/);
    assert.match(CODE, /typingTimerRef\.current = setTimeout\(\(\) => \{\s*typingSubRef\.current\?\.setTyping\(false\);/);
    assert.match(CODE, /sub\.setTyping\(false\);\s*sub\.unsubscribe\(\);/, "and on teardown");
  });
});

describe("one platform split, in the hook that owns it", () => {
  // The screen hand-rolled the web/native departure listener — the third copy
  // in the tree after `lib/use-app-away.ts` and `lib/use-visibility-refresh.ts`
  // — and its web half listened for `visibilitychange` only. Alt-tabbing to
  // another app is the commonest way a desktop user leaves and
  // `document.hidden` reports it as `false`, so the copy that lived here did
  // not see it: the other side kept "is typing…" until a timer said otherwise.
  it("clears typing presence through useAppAway", () => {
    assert.match(CODE, /import \{ useAppAway \} from "@\/lib\/use-app-away";/);
    assert.match(
      CODE,
      /useAppAway\(\(\) => \{\s*if \(typingTimerRef\.current\) \{\s*clearTimeout\(typingTimerRef\.current\);\s*typingTimerRef\.current = null;\s*\}\s*typingSubRef\.current\?\.setTyping\(false\);\s*\}\);/,
    );
  });

  it("holds no departure listener of its own any more", () => {
    assert.ok(!/visibilitychange/.test(CODE), "the web half of the split is back in the screen");
    assert.ok(!/AppState/.test(CODE), "the native half of the split is back in the screen");
  });

  it("keeps Platform for the one thing that is genuinely per-platform here", () => {
    // The keyboard inset. `AppState` left with the listener; `Platform` stays
    // because iOS needs `padding` and Android does not.
    assert.match(CODE, /behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/);
  });
});

describe("the button says what the guard is doing", () => {
  // `sendingRef` refuses the second press correctly and invisibly: on a slow
  // connection the first press clears nothing for a second or two and the
  // button stays bright, so the only honest reading of the interface is that
  // the press did not land. The guard was right and the control was lying.
  it("drives disabled, the style, the icon and the a11y state off one reading", () => {
    // Four copies of `text.trim()` is how a control comes to LOOK enabled
    // while refusing presses: the round that adds a second condition has to
    // remember all four.
    assert.match(CODE, /const canSend = text\.trim\(\)\.length > 0 && !sending;/);
    assert.match(CODE, /style=\{\[styles\.sendButton, !canSend && styles\.sendButtonDisabled\]\}/);
    assert.match(CODE, /disabled=\{!canSend\}/);
    assert.match(CODE, /color=\{canSend \? TEXT_ON_DARK_5 : AMBER_MUTED\}/);
  });

  it("announces busy as well as disabled", () => {
    // "Dimmed" says the press will not land; `busy` says why — the message is
    // going out, not that there is nothing to send.
    assert.match(CODE, /accessibilityState=\{\{ disabled: !canSend, busy: sending \}\}/);
  });

  it("keeps the ref, because a state cannot refuse a press in the same tick", () => {
    // The state is for the user and the ref is for the second press: a
    // `setState` has not re-rendered when a double tap or an `onSubmitEditing`
    // landing on top of its own press arrives.
    assert.match(CODE, /if \(sendingRef\.current\) return;\s*sendingRef\.current = true;\s*setSending\(true\);/);
  });

  it("clears the ref unconditionally and the state only while mounted", () => {
    // `sendMessage` awaits a cloud insert and the user can leave mid-flight. A
    // `setState` after the screen is gone is the defect `app/profile/[id].tsx`
    // grew its own `mountedRef` for — on the same slow connection that makes
    // the dimmed button visible in the first place.
    assert.match(
      CODE,
      /sendingRef\.current = false;\s*if \(mountedRef\.current\) setSending\(false\);/,
    );
    // Through `lib/use-mounted-ref.ts` since the two create forms became the
    // third and fourth copy of the same five lines; `use-mounted-ref.test.ts`
    // runs the hook and `create-forms-double-submit.test.ts` sweeps for a
    // screen that writes the assignment by hand again.
    assert.match(CODE, /const mountedRef = useMountedRef\(\);/);
  });

  it("still lets the keyboard's send key through", () => {
    // Both entry points stay wired; the fix is the visible state, not removing
    // one of them.
    assert.match(CODE, /onSubmitEditing=\{handleSend\}/);
    assert.match(CODE, /onPress=\{handleSend\}/);
  });
});
