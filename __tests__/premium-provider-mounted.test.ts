import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { mockModule } from "./helpers/render";
import {
  drain,
  installSpyAsyncStorage,
  installSpyToast,
  installStubI18n,
  mountStorageNoticeListener,
  providerHarness,
  resetStorageNotice,
} from "./helpers/mount-provider";

/**
 * `PremiumProvider`, mounted.
 *
 * The third provider mounted this run and the first that needed a SESSION:
 * `useAuth` decides its storage key, so the scaffolding everyone named as the
 * blocker for this class turns out to be one `mockModule` returning a `user`
 * object a `let` can swap. `cloudValidatePremium` is mocked beside it, because
 * the hydrate awaits it unconditionally.
 *
 * What this provider gets wrong is expensive in one direction only: it holds a
 * PAID entitlement, and every failure mode that writes when it should not, or
 * writes the wrong account's blob, ends with somebody who paid being told they
 * did not. Its persist gate was added by inspection during the persist-gate
 * sweep; these cases are the first time anything has run it.
 */

const spy = installSpyAsyncStorage();
const { reads, writes, store } = spy;
const captured: { error: unknown; context: { scope?: string } }[] = [];
/** What `useAuth()` answers — reassigned between renders, like a sign-in. */
let user: { id: string } | null = { id: "user-a" };
/** What the cloud says; `null` is the transient-failure answer. */
let validation: unknown = null;

const toasts = installSpyToast();
installStubI18n();

mockModule("@/lib/sentry", {
  captureException: (error: unknown, context: { scope?: string }) =>
    captured.push({ error, context }),
});

mockModule("@/lib/auth-context", {
  useAuth: () => ({ user }),
});

mockModule("@/lib/supabase-subscriptions", {
  cloudValidatePremium: async () => validation,
});

type PremiumModule = typeof import("../lib/premium-context");
type ContextValue = ReturnType<PremiumModule["usePremium"]>;

const harness = providerHarness<ContextValue>(async () => {
  const premium: PremiumModule = await import("../lib/premium-context");
  return { Provider: premium.PremiumProvider, useValue: premium.usePremium };
});

const mount = () => harness.mount();
const seen = () => harness.seen;

const KEY_A = "collectables-premium-v1-user-a";
const KEY_B = "collectables-premium-v1-user-b";
/**
 * A subscription bought an hour ago. Dated relative to NOW rather than pinned:
 * premium runs for `PREMIUM_PERIOD_DAYS`, and a fixture with a literal date
 * quietly becomes an EXPIRED one thirty days after somebody writes it — the
 * cases would then read "restores a paid entitlement" while proving the
 * expiry path.
 */
const PAID_SINCE = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const PAID = JSON.stringify({
  isPremium: true,
  activatedAt: PAID_SINCE,
  premiumActivatedAt: PAID_SINCE,
});

function keysWritten(): string[] {
  return writes.map((write) => write.key);
}

beforeEach(async () => {
  spy.reset();
  harness.reset();
  toasts.length = 0;
  await resetStorageNotice();
  captured.length = 0;
  user = { id: "user-a" };
  validation = null;
});

describe("PremiumProvider — hydrating one account", () => {
  it("reads the account's own key and restores a paid entitlement", async () => {
    store.set(KEY_A, PAID);
    await mount();

    assert.deepEqual(reads, [KEY_A]);
    assert.equal(seen()?.isPremium, true);
    assert.equal(seen()?.ready, true);
  });

  it("a signed-out session reads nothing and writes nothing", async () => {
    user = null;
    await mount();

    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
    assert.equal(seen()?.ready, true);
    assert.equal(seen()?.isPremium, false);
  });

  it("a failed read does NOT write, because that would downgrade a payer", async () => {
    store.set(KEY_A, PAID);
    spy.readError = new Error("SecurityError: localStorage is not available");
    await mount();

    assert.deepEqual(writes, [], "a storage read must never cost somebody their entitlement");
    assert.equal(store.get(KEY_A), PAID, "what is on disk stays on disk");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].context.scope, "premium-context.getItem");
  });

  it("an unparseable cache is rewritten, because the cloud owns these rows", async () => {
    store.set(KEY_A, "{ not json");
    await mount();

    // The WEAKER of the two gates, on purpose: the read succeeded, so the blob
    // may be replaced. A cache nothing can parse has no future but repair.
    assert.deepEqual(keysWritten(), [KEY_A]);
    assert.equal(seen()?.isPremium, false);
  });

  it("a transient cloud failure keeps the cached entitlement", async () => {
    store.set(KEY_A, PAID);
    validation = null;
    await mount();

    assert.equal(seen()?.isPremium, true, "null means 'ask again later', not 'not a subscriber'");
  });
});

describe("PremiumProvider — the user acts", () => {
  it("activating persists the new state under the account's key", async () => {
    const tree = await mount();
    writes.length = 0;

    seen()!.activatePremium("settings");
    tree.rerender();
    await drain(tree);

    assert.equal(seen()?.isPremium, true);
    assert.deepEqual(keysWritten(), [KEY_A]);
    assert.equal(JSON.parse(writes[0].value).isPremium, true);
  });

  it("the activation source is one-shot: consuming it resets to server_sync", async () => {
    const tree = await mount();

    seen()!.activatePremium("upsell_sheet");
    tree.rerender();

    assert.equal(seen()!.consumeLastPremiumIntent(), "upsell_sheet");
    assert.equal(seen()!.consumeLastPremiumIntent(), "server_sync");
  });

  it("a session that could not READ still refuses to write what the user does", async () => {
    store.set(KEY_A, PAID);
    spy.readError = new Error("SecurityError");
    const tree = await mount();
    writes.length = 0;

    seen()!.activatePremium("settings");
    tree.rerender();
    await drain(tree);

    // The known cost of the gate, stated rather than discovered: this session
    // writes nothing at all, so the flip lives until relaunch. It is the right
    // trade against writing "free" over a paying user's blob, and it is the
    // reason the refusal deserves to be visible to the user somewhere.
    assert.equal(seen()?.isPremium, true);
    assert.deepEqual(writes, []);
  });
});

/**
 * The listener is mounted explicitly here because the provider no longer
 * carries it: the write half of the notice is one component under
 * `ToastProvider` in `app/_layout.tsx`, and the provider's part is to REPORT.
 * Both cases mount it, so the silent one is a fact about a healthy session
 * rather than about a missing subscriber.
 */
describe("PremiumProvider — the store stops accepting writes", () => {
  it("tells the user, through the same notice the refused hydrate uses", async () => {
    await mountStorageNoticeListener();
    const tree = await mount();
    assert.deepEqual(toasts, [], "the hydrate worked, so nothing has been said yet");

    spy.writeError = new Error("QuotaExceededError");
    seen()!.activatePremium("settings");
    tree.rerender();
    await drain(tree);

    assert.deepEqual(toasts, [
      {
        level: "error",
        message: "storagePersistRefusedMessage",
        title: "storagePersistRefusedTitle",
      },
    ]);
  });

  it("says nothing while writes are landing", async () => {
    await mountStorageNoticeListener();
    const tree = await mount();

    seen()!.activatePremium("settings");
    tree.rerender();
    await drain(tree);

    assert.deepEqual(toasts, [], "a healthy session must not be interrupted");
  });
});

describe("PremiumProvider — the account changes under it", () => {
  /**
   * The failure the hydration-gate sweep names in its own words — "it must be
   * cleared when the account changes, or a sign-out's cleared state is written
   * over the NEXT account's blob" — asked of the provider instead of of its
   * source.
   *
   * When `user` changes, the render that sees the new key still holds the OLD
   * account's `state`, `ready` and gate. Both effects run against that render:
   * the hydrate schedules `setReady(false)`, but a scheduled state update is
   * not a current one, so the persist effect beside it reads the values it was
   * rendered with — `ready: true`, gate open — and writes user A's entitlement
   * under user B's key.
   */
  it("does not write one account's entitlement under the next account's key", async () => {
    store.set(KEY_A, PAID);
    const tree = await mount();
    writes.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await drain(tree);

    assert.deepEqual(
      writes.filter((write) => write.key === KEY_B && JSON.parse(write.value).isPremium === true),
      [],
      "user B must not inherit user A's premium from a shared device",
    );
  });

  it("signing out clears the entitlement without writing it anywhere", async () => {
    store.set(KEY_A, PAID);
    const tree = await mount();
    writes.length = 0;

    user = null;
    tree.rerender();
    await drain(tree);

    assert.equal(seen()?.isPremium, false);
    assert.deepEqual(writes, [], "there is no key to write to, and nothing to say");
  });

  it("hydrates the new account from the new account's key", async () => {
    store.set(KEY_A, PAID);
    const tree = await mount();
    reads.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await drain(tree);

    assert.deepEqual(reads, [KEY_B]);
    assert.equal(seen()?.isPremium, false, "user B has nothing stored and is not a subscriber");
  });
});
