import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DELETE_ACCOUNT_STEPS,
  runDeleteAccount,
  type DeleteAccountSteps,
} from "@/lib/delete-account-flow";

import { readRepoFile } from "./helpers/repo-file";
import { stripComments } from "@/lib/strip-comments";

/** Every step succeeding, with a log of what ran. */
function happyPath(log: string[]): DeleteAccountSteps {
  return {
    listImageUrls: async () => {
      log.push("listImageUrls");
      return ["https://res.cloudinary.com/x/a.jpg"];
    },
    deleteImages: async () => {
      log.push("deleteImages");
    },
    deleteAccount: async () => {
      log.push("deleteAccount");
      return {};
    },
    clearLocalData: async () => {
      log.push("clearLocalData");
    },
    signOut: async () => {
      log.push("signOut");
    },
  };
}

/** The happy path with one step replaced. */
function withStep<K extends keyof DeleteAccountSteps>(
  log: string[],
  key: K,
  step: DeleteAccountSteps[K],
): DeleteAccountSteps {
  return { ...happyPath(log), [key]: step };
}

describe("runDeleteAccount — the happy path", () => {
  it("runs the five steps in order", async () => {
    const log: string[] = [];
    const outcome = await runDeleteAccount(happyPath(log));
    assert.deepEqual(outcome, { warnings: [], localDataRemains: false });
    assert.deepEqual(log, [
      "listImageUrls",
      "deleteImages",
      "deleteAccount",
      "clearLocalData",
      "signOut",
    ]);
  });

  it("skips the image sweep when there is nothing to sweep", async () => {
    // Asking Cloudinary to delete an empty list is a round trip that can only
    // fail; `deleteImagesViaEdgeFunction` already short-circuits on it, and
    // this keeps the call from being made at all.
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "listImageUrls", async () => {
        log.push("listImageUrls");
        return [];
      }),
    );
    assert.deepEqual(outcome.warnings, []);
    assert.ok(!log.includes("deleteImages"));
  });
});

describe("runDeleteAccount — a failure BEFORE the delete must not block it", () => {
  // The bug. A throw from either best-effort step used to leave the account
  // alive: an image listing that timed out meant the user's delete request
  // simply did not happen, and nothing said so.
  it("deletes the account anyway when listing the images throws", async () => {
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "listImageUrls", () => Promise.reject(new Error("Network request failed"))),
    );
    assert.equal(outcome.error, undefined, "the account was not deleted because of an image list");
    assert.ok(log.includes("deleteAccount"));
    assert.deepEqual(
      outcome.warnings.map((w) => w.step),
      ["listImageUrls"],
    );
    assert.equal(outcome.warnings[0].reason, "Network request failed");
  });

  it("does not make a failed listing a precondition for the sweep", async () => {
    // The two best-effort steps are independent: a listing that threw yields
    // no URLs, so there is nothing to sweep, and the warning already names
    // what went wrong.
    const log: string[] = [];
    await runDeleteAccount(
      withStep(log, "listImageUrls", () => Promise.reject(new Error("boom"))),
    );
    assert.ok(!log.includes("deleteImages"));
  });

  it("deletes the account anyway when the image sweep throws", async () => {
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "deleteImages", () => Promise.reject(new Error("cloudinary down"))),
    );
    assert.equal(outcome.error, undefined);
    assert.ok(log.includes("deleteAccount"));
    assert.deepEqual(
      outcome.warnings.map((w) => w.step),
      ["deleteImages"],
    );
  });

  it("keeps the original thrown value for the reporter", async () => {
    // `captureException` wants the thrown value, not a sentence built from
    // it, so the warning carries both.
    const cause = new Error("cloudinary down");
    const log: string[] = [];
    const outcome = await runDeleteAccount(withStep(log, "deleteImages", () => Promise.reject(cause)));
    assert.equal(outcome.warnings[0].cause, cause);
  });
});

describe("runDeleteAccount — the delete itself is the one failure that IS the answer", () => {
  it("reports the envelope's error and stops", async () => {
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "deleteAccount", async () => {
        log.push("deleteAccount");
        return { error: "No session" };
      }),
    );
    assert.equal(outcome.error, "No session");
    assert.ok(!log.includes("clearLocalData"), "local data was cleared for an account that still exists");
    assert.ok(!log.includes("signOut"));
  });

  it("reports a throw as the error rather than letting it out", async () => {
    // The call is supposed to return an envelope (`lib/edge-function-call.ts`),
    // so this is the belt to that braces: a throw means the account may or may
    // not exist, and clearing the user's data on a maybe is the one outcome
    // that cannot be taken back.
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "deleteAccount", () => Promise.reject(new Error("Load failed"))),
    );
    assert.equal(outcome.error, "Load failed");
    assert.ok(!log.includes("clearLocalData"));
  });

  it("gives a printable reason for a thrown non-Error", async () => {
    const log: string[] = [];
    for (const [thrown, expected] of [
      ["refused", "refused"],
      [new Error(""), "unknown error"],
      [{ code: 500 }, "unknown error"],
      [undefined, "unknown error"],
    ] as const) {
      const outcome = await runDeleteAccount(
        withStep(log, "deleteAccount", () => Promise.reject(thrown)),
      );
      assert.equal(outcome.error, expected);
    }
  });
});

describe("runDeleteAccount — a failure AFTER the delete is not a deletion failure", () => {
  // The worst of the three, and the reason one `catch` would have been the
  // wrong fix: the account is already gone, so "we could not delete your
  // account" would be false AND would send the user to retry something that
  // now fails against a deleted account, while the app still looks signed in.
  it("still succeeds when clearing local data throws", async () => {
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "clearLocalData", () => Promise.reject(new Error("storage full"))),
    );
    assert.equal(outcome.error, undefined);
    assert.deepEqual(
      outcome.warnings.map((w) => w.step),
      ["clearLocalData"],
    );
  });

  it("says the device still holds the deleted account's rows", async () => {
    // The one warning with a consequence for somebody other than a log
    // reader: `clearAllUserData` is a single all-or-nothing `multiRemove`, so
    // a failure leaves the collections, items, chat cache and language in
    // storage while the app navigates away looking signed out — and the next
    // person to open it on this device sees a stranger's collections.
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "clearLocalData", () => Promise.reject(new Error("storage full"))),
    );
    assert.equal(outcome.localDataRemains, true);
    assert.equal(outcome.error, undefined, "it is not an error — retrying would hit a deleted account");
  });

  it("is false when the clear succeeded, whatever else failed", async () => {
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "signOut", () => Promise.reject(new Error("socket closed"))),
    );
    assert.equal(outcome.localDataRemains, false);
  });

  it("is false when the account was never deleted", async () => {
    // Nothing was cleared because nothing should have been: the data on this
    // device belongs to an account that still exists.
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "deleteAccount", async () => ({ error: "No session" })),
    );
    assert.equal(outcome.localDataRemains, false);
  });

  it("still signs out when clearing local data threw", async () => {
    // The steps after a failed cleanup step still run: an open realtime
    // socket on a deleted account is worse than a stale storage key.
    const log: string[] = [];
    await runDeleteAccount(
      withStep(log, "clearLocalData", () => Promise.reject(new Error("storage full"))),
    );
    assert.ok(log.includes("signOut"));
  });

  it("still succeeds when signing out throws", async () => {
    const log: string[] = [];
    const outcome = await runDeleteAccount(
      withStep(log, "signOut", () => Promise.reject(new Error("socket closed"))),
    );
    assert.equal(outcome.error, undefined);
    assert.deepEqual(
      outcome.warnings.map((w) => w.step),
      ["signOut"],
    );
  });

  it("collects every warning rather than the first", async () => {
    const log: string[] = [];
    const outcome = await runDeleteAccount({
      ...happyPath(log),
      listImageUrls: () => Promise.reject(new Error("a")),
      clearLocalData: () => Promise.reject(new Error("b")),
      signOut: () => Promise.reject(new Error("c")),
    });
    assert.equal(outcome.error, undefined);
    assert.deepEqual(
      outcome.warnings.map((w) => w.step),
      ["listImageUrls", "clearLocalData", "signOut"],
    );
  });
});

describe("runDeleteAccount — no step rejects out of it", () => {
  it("every step can throw and the call still resolves", async () => {
    // The claim the whole module exists for: `deleteAccount`'s signature
    // promises `{ error?: string }`, and before 2026-10-19 any of five
    // rejections made that a lie — straight past `app/settings.tsx`' own
    // `try … finally` to nothing on screen.
    const log: string[] = [];
    const keys: readonly (keyof DeleteAccountSteps)[] = [
      "listImageUrls",
      "deleteImages",
      "deleteAccount",
      "clearLocalData",
      "signOut",
    ];
    for (const key of keys) {
      const outcome = await runDeleteAccount(
        withStep(log, key, (() => Promise.reject(new Error(key))) as never),
      );
      assert.ok(outcome, `${key} rejected out of runDeleteAccount`);
    }
  });

  it("names every warning-bearing step, and not the one whose failure is the answer", async () => {
    assert.deepEqual(
      [...DELETE_ACCOUNT_STEPS],
      ["listImageUrls", "deleteImages", "clearLocalData", "signOut"],
    );
    assert.ok(
      !(DELETE_ACCOUNT_STEPS as readonly string[]).includes("deleteAccount"),
      "the delete itself cannot be a warning — its failure is the error",
    );
  });
});

describe("the two call sites that used to have no catch", () => {
  it("lib/auth-context.tsx runs the flow rather than awaiting five things in a row", () => {
    const code = stripComments(readRepoFile("lib/auth-context.tsx"));
    assert.match(code, /const \{ error, warnings, localDataRemains \} = await runDeleteAccount\(\{/);
    // Destructured shorthand, which `analytics-pii.test.ts` requires of every
    // `extra`: the allow-list rules on the NAME, so a value assembled at the
    // call site would say nothing about what reaches Sentry.
    assert.match(code, /for \(const \{ step, reason, cause \} of warnings\)/);
    assert.match(code, /captureException\(cause, \{[\s\S]*?extra: \{ step, reason \}/);
    assert.ok(
      !/await deleteAccountViaEdgeFunction\(\);/.test(code),
      "the provider calls the Edge Function directly again, outside the flow",
    );
  });

  it("app/settings.tsx now has a catch and not only a finally", () => {
    const code = stripComments(readRepoFile("app/settings.tsx"));
    assert.match(
      code,
      /await deleteAccount\(\);[\s\S]*?\} catch \{[\s\S]*?reportDeleteFailed\(\);[\s\S]*?\} finally \{/,
      "performDelete must report a throw, not swallow it into a stopped spinner",
    );
  });

  it("app/settings.tsx tells the user when the device still holds the data", () => {
    const code = stripComments(readRepoFile("app/settings.tsx"));
    assert.match(code, /const \{ error, localDataRemains \} = await deleteAccount\(\);/);
    assert.match(
      code,
      /if \(localDataRemains\) notify\(t\("deleteAccountLocalDataRemains"\)\);\s*router\.replace\("\/"\);/,
      "the warning must be shown AND the navigation must still happen — the account is gone either way",
    );
  });

  it("both branches report through one function, so they cannot drift", () => {
    // The alert is platform-split (`globalThis.alert` on web, `Alert.alert`
    // native), which is two lines nobody wants written twice — the shape that
    // let the error branch and the throw branch say different things.
    const code = stripComments(readRepoFile("app/settings.tsx"));
    assert.equal(
      code.split("reportDeleteFailed()").length - 1,
      3,
      "a delete-failure path stopped going through reportDeleteFailed",
    );
  });
});
