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
    assert.match(CODE, /\} finally \{\s*sendingRef\.current = false;\s*\}/);
  });

  it("keeps both entry points, because both are how people send a message", () => {
    // The keyboard's send key and the button, each still wired — the fix is
    // the guard, not removing one of them.
    assert.match(CODE, /onSubmitEditing=\{handleSend\}/);
    assert.match(CODE, /onPress=\{handleSend\}/);
  });

  it("uses a ref rather than state for the guard", () => {
    // The second press is in the same tick as the first; a `setState` has not
    // re-rendered when it arrives. Same reason as `hasAttemptedShareSaveRef`.
    assert.ok(
      !/const \[sending, setSending\] = useState/.test(CODE),
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
