import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { balancedEnd, balancedInner } from "@/lib/balanced-source";

import { installSpyCapture } from "./helpers/mount-provider";
import { assertNoOffenders } from "./helpers/offence-sweep";
import { installNativeModuleStubs } from "./helpers/render";
import {
  allSignals,
  classifierSignals,
  KNOWN_CLASSIFIER_SIGNALS,
  PLANTED_CLASSIFIERS,
  READABLE_PLANTED_CLASSIFIERS,
  signalsInSource,
  STORAGE_ERROR_INPUTS,
  STORAGE_ERROR_SAMPLES,
  UNREADABLE_PLANTED_CLASSIFIERS,
} from "./helpers/storage-error-samples";
import { expectStorageReport } from "./helpers/storage-failure-report";
import { readRepoFile } from "./helpers/repo-file";
import { readSource, sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * `reportStorageFailure` — one budget for every swallowed storage failure.
 *
 * `usePersistedBlob` reported a rejected `setItem` and nothing else in the tree
 * did, so a full device store was visible only when the failing blob happened
 * to be one of the five `CollectionsProvider` owns. The writes that were left
 * silent are the ones whose failure is not lost data but corrupted sync — the
 * tombstone store (a failed write or an unreadable read makes the delta pull
 * hold its cursor, forever, with nothing counting the retries) and the cursor
 * store (a failed write quietly returns every later pull to the whole-table
 * fetch BE-14 replaced).
 *
 * Two decisions are what this suite is actually about, because both are the
 * kind that look like an implementation detail and are not:
 *
 *   1. The budget is SHARED across call sites. A per-module `Set` would let
 *      one full disk report once per module that noticed it, which is the
 *      "one disk becomes a stream" outcome the budget exists to prevent,
 *      reached by addition instead of repetition.
 *
 *   2. It is keyed by the SITE as well as the keyspace. "The tombstone store
 *      could not be read" and "could not be written" are different diagnoses;
 *      collapsing them lets whichever happened first hide the other for the
 *      rest of the session.
 */

installNativeModuleStubs();

const captured = installSpyCapture();

/** A real per-user key: every builder in `storage-keys.ts` ends in the auth id. */
const AUTH_ID = "11111111-2222-4333-8444-555555555555";
const ITEMS_KEY = `collectables-items-v1-${AUTH_ID}`;
const TOMBSTONE_KEY = `collectables-tombstones-v1-items-${AUTH_ID}`;

/**
 * `mockModule` only takes effect for a module that has not been evaluated yet,
 * and a static `import` here would pull the REAL `@/lib/sentry` through this
 * module before the shim is registered. So the helper — and the site list the
 * adoption cases derive everything from — is loaded lazily.
 */
async function load() {
  return import("@/lib/report-storage-failure");
}

beforeEach(async () => {
  captured.length = 0;
  (await load()).__resetStorageFailureReportsForTests();
});

describe("reportStorageFailure", () => {
  it("reports the keyspace and the scope, never the raw key", async () => {
    const { reportStorageFailure } = await load();
    const error = new Error("quota exceeded");

    assert.equal(reportStorageFailure("tombstones.setItem", TOMBSTONE_KEY, error), true);

    assert.equal(captured.length, 1);
    assert.equal(captured[0].error, error);
    expectStorageReport(captured, {
      scope: "tombstones.setItem",
      keyspace: "collectables-tombstones-v1-items-{id}",
      reason: "full",
    });
    assert.equal(
      JSON.stringify(captured).includes(AUTH_ID),
      false,
      "the account's auth id must not reach the crash report — scrubPII does not read `extra`",
    );
  });

  it("keeps the entity in the keyspace, because it says which pull broke", async () => {
    const { reportStorageFailure } = await load();
    reportStorageFailure("sync-cursors.setItem", `collectables-sync-cursor-v1-items-${AUTH_ID}`, 1);
    reportStorageFailure(
      "sync-cursors.setItem",
      `collectables-sync-cursor-v1-collections-${AUTH_ID}`,
      2,
    );
    assert.deepEqual(
      captured.map((c) => (c.context as { extra: { keyspace: string } }).extra.keyspace),
      [
        "collectables-sync-cursor-v1-items-{id}",
        "collectables-sync-cursor-v1-collections-{id}",
      ],
      "the two entities are two stores and two reports",
    );
  });

  it("reports one site/keyspace pair once per session, however many failures", async () => {
    const { reportStorageFailure } = await load();
    assert.equal(reportStorageFailure("tombstones.setItem", TOMBSTONE_KEY, 1), true);
    assert.equal(reportStorageFailure("tombstones.setItem", TOMBSTONE_KEY, 2), false);
    assert.equal(reportStorageFailure("tombstones.setItem", TOMBSTONE_KEY, 3), false);
    assert.equal(captured.length, 1);
  });

  it("spends one budget for two accounts, because the store is the device's", async () => {
    // Per keyspace rather than per key: signing in as a second account on a
    // full device must not re-report the same disk.
    const { reportStorageFailure } = await load();
    reportStorageFailure("tombstones.setItem", TOMBSTONE_KEY, 1);
    reportStorageFailure(
      "tombstones.setItem",
      "collectables-tombstones-v1-items-99999999-8888-4777-8666-555555555555",
      2,
    );
    assert.equal(captured.length, 1);
  });

  it("reports a read and a write on the SAME store separately", async () => {
    // Two diagnoses with two fixes. One budget for both would let whichever
    // happened first hide the other for the rest of the session.
    const { reportStorageFailure } = await load();
    assert.equal(reportStorageFailure("tombstones.getItem", TOMBSTONE_KEY, 1), true);
    assert.equal(reportStorageFailure("tombstones.setItem", TOMBSTONE_KEY, 2), true);
    assert.deepEqual(
      captured.map((c) => (c.context as { scope: string }).scope),
      ["tombstones.getItem", "tombstones.setItem"],
    );
  });

  it("reports two keyspaces from one site separately", async () => {
    const { reportStorageFailure } = await load();
    assert.equal(reportStorageFailure("use-persisted-blob.setItem", ITEMS_KEY, 1), true);
    assert.equal(
      reportStorageFailure(
        "use-persisted-blob.setItem",
        `collectables-collections-v1-${AUTH_ID}`,
        2,
      ),
      true,
    );
    assert.equal(captured.length, 2);
  });

  it("cannot collide two pairs on one budget entry", async () => {
    // The separator is the reason this holds: a scope and a keyspace both
    // contain "-", so a "-" join would make ("a-b", "c") and ("a", "b-c") the
    // same entry and silently drop the second report.
    //
    // UNREACHABLE FROM OUTSIDE, and that is the claim rather than the caveat:
    // `StorageFailureSite` is a closed union of ten literals and no pair of
    // them can collide with any pair of keyspaces. The cast is what lets the
    // property be asserted at all, and a separator edited back to "-" turns
    // this red instead of waiting for the eleventh site to be the one that
    // collides.
    const { reportStorageFailure } = await load();
    const report = reportStorageFailure as unknown as (
      scope: string,
      key: string,
      error: unknown,
    ) => boolean;
    assert.equal(report("a-b", "c", 1), true);
    assert.equal(report("a", "b-c", 2), true);
    assert.equal(captured.length, 2);
  });

  it("keeps a key with no per-user half intact", async () => {
    const { reportStorageFailure } = await load();
    reportStorageFailure("use-persisted-blob.setItem", "collectables-language-v1", 1);
    expectStorageReport(captured, {
      scope: "use-persisted-blob.setItem",
      keyspace: "collectables-language-v1",
      reason: "unavailable",
    });
  });

  it("__resetStorageFailureReportsForTests clears the budget", async () => {
    const { reportStorageFailure, __resetStorageFailureReportsForTests } = await load();
    assert.equal(reportStorageFailure("tombstones.setItem", TOMBSTONE_KEY, 1), true);
    assert.equal(reportStorageFailure("tombstones.setItem", TOMBSTONE_KEY, 2), false);
    __resetStorageFailureReportsForTests();
    assert.equal(
      reportStorageFailure("tombstones.setItem", TOMBSTONE_KEY, 3),
      true,
      "without this every suite after the first would assert against a spent budget",
    );
  });
});

/**
 * The one thing about a storage failure the USER can act on.
 *
 * A full disk and a blocked store both end in "changes aren't being saved" and
 * have opposite fixes — free up space, or restart — so the notice needs the
 * cause, and the cause is only ever a guess read off an error object every
 * engine spells differently. The default when nothing matches is the one that
 * does not send somebody deleting photos for a `SecurityError`.
 */
describe("classifyStorageError", () => {
  it("rides along to Sentry, so the guess can be measured rather than believed", async () => {
    const { reportStorageFailure } = await load();

    reportStorageFailure(
      "premium-context.setItem",
      "collectables-premium-v1-user-a",
      Object.assign(new Error("localStorage is not available"), { name: "SecurityError" }),
    );

    expectStorageReport(captured, {
      scope: "premium-context.setItem",
      keyspace: "collectables-premium-v1-{id}",
      reason: "unavailable",
    });
  });

  it("classifies every shared sample the way the sample says it does", async () => {
    const { classifyStorageError } = await load();

    // The samples carry their expected reason so the OTHER suites reading them
    // do not each have to restate it. That only works if the pairs are true,
    // which is this case: the quota spellings the engines use, a store that is
    // merely blocked, and the values a `catch` binds when nothing threw an
    // `Error` at all.
    for (const { signal, error, reason } of STORAGE_ERROR_SAMPLES) {
      assert.equal(classifyStorageError(error), reason, `signal ${signal}: ${String(error)}`);
    }
  });

  it("has a sample for every signal its own body reads", () => {
    // The lists this replaced were hand-made samples of the classifier's input
    // space with no edge back to it: a fifth signal added to the classifier got
    // an input in neither suite, and every case written as a property over
    // "everything the classifier reads" kept passing over less than it said.
    // The edge is this — the signals come out of the classifier's own body.
    const signals = allSignals(classifierSignals());
    assert.ok(
      signals.length >= KNOWN_CLASSIFIER_SIGNALS,
      `classifier signals dropped to ${String(signals.length)} from ${String(KNOWN_CLASSIFIER_SIGNALS)} — a removed branch takes its sample's meaning with it, and a shape this reader does not know (a regex, a startsWith) is a signal with no sample at all`,
    );
    const sampled = new Set(STORAGE_ERROR_SAMPLES.map((sample) => sample.signal));
    for (const signal of signals) {
      assert.ok(
        sampled.has(signal),
        `classifyStorageError reads "${signal}" and no sample carries it — add one to STORAGE_ERROR_SAMPLES, or the branch is exercised by nothing`,
      );
    }
  });

  it("reads no signal that another signal already covers", () => {
    // `disk is full` and `database or disk is full` were both checked, in that
    // order, and the second could never be the one that returned: every string
    // containing it contains the first. A substring pair is dead source that
    // reads as thoroughness — two spellings, one of them unreachable — and it
    // survived because nothing put the two clauses side by side until the
    // samples derived them from the body. `phrases` only: a numeric `code` is
    // compared rather than searched, so "22" inside "1022" means nothing.
    assertNoDeadPhrase(classifierSignals().phrases);
  });

  /**
   * The rule the case above applies, so a planted classifier can be held to it.
   *
   * A guard that only ever runs over source satisfying it is green for two
   * indistinguishable reasons: the tree is clean, or the reader found nothing.
   */
  function assertNoDeadPhrase(phrases: readonly string[]): void {
    for (const phrase of phrases) {
      for (const other of phrases) {
        assert.ok(
          phrase === other || !phrase.includes(other),
          `classifyStorageError checks "${phrase}" and "${other}" separately, but the second is a substring of the first — the longer clause can never decide, so it is dead source`,
        );
      }
    }
  }

  describe("the signal reader, held to classifiers that are not ours", () => {
    // The dead pair in the real classifier was proven by editing `lib/` by
    // hand, running the suite and putting the file back — evidence that lived
    // in a terminal, for a guard whose entire value is that it fails on that
    // input. These are the same needles, in the repo.

    it("rejects the substring pair that was really there", () => {
      const { phrases } = signalsInSource(PLANTED_CLASSIFIERS.deadSubstring);
      assert.deepEqual(phrases, ["disk is full", "database or disk is full"]);
      assert.throws(
        () => {
          assertNoDeadPhrase(phrases);
        },
        /the longer clause can never decide/,
        "the rule that found the dead clause has to fail on it",
      );
    });

    it("sees a signal that no sample carries", () => {
      const signals = allSignals(signalsInSource(PLANTED_CLASSIFIERS.unsampledSignal));
      assert.deepEqual(signals, ["storage is over capacity"]);
      const sampled = new Set(STORAGE_ERROR_SAMPLES.map((sample) => sample.signal));
      assert.ok(!sampled.has(signals[0]), "an added signal is what the coverage loop must catch");
    });

    it("keeps the two kinds apart rather than flattening them", () => {
      const { codes, phrases } = signalsInSource(PLANTED_CLASSIFIERS.bothKinds);
      assert.deepEqual(codes, ["22", "1014"]);
      assert.deepEqual(phrases, ["quota"], "a code must not reach the substring rule");
    });

    it("follows the arrow-const form to the signals in its body", () => {
      // This one used to be a refusal, which made the reader a rule the
      // codebase never agreed to: nothing lints against `const
      // classifyStorageError = (…) => {…}`, so writing one would have turned
      // the suite red over a reader's limitation rather than over the code.
      // Asserting the exact signals, not merely that it did not throw — the
      // failure worth catching is a reader that finds the declaration and then
      // scans the wrong span.
      assert.deepEqual(signalsInSource(PLANTED_CLASSIFIERS.arrowConst), {
        codes: [],
        phrases: ["quota"],
      });
    });

    it("refuses the two absences instead of reporting zero signals", () => {
      // The failure mode a derived rule has and a hand-written list does not:
      // "found nothing" and "there is nothing to find" are the same value. The
      // reader is the layer that knows which it is holding, so it says so —
      // the floor two layers up would have called a renamed classifier "the
      // signal count dropped to 0", which is true and about the wrong file.
      //
      // `conciseArrow` is the absence the arrow form brought with it, and the
      // only one where the wrong answer is worse than none: its needle carries
      // a neighbouring function, so a reader that scanned forward for a brace
      // would return that function's `"neighbour"` as a signal of this one.
      for (const [needle, message] of Object.entries(UNREADABLE_PLANTED_CLASSIFIERS)) {
        assert.throws(
          () => {
            signalsInSource(PLANTED_CLASSIFIERS[needle]);
          },
          message,
          `${needle}: the reader must name which absence this is`,
        );
      }
    });

    it("parses every needle that is supposed to parse", () => {
      // The needles are source strings nothing else compiles, so a typo in one
      // degrades to "the reader found nothing" and its own case passes for the
      // wrong reason. Two of them assert exact signal lists and were already
      // pinned; this covers the rest, and any needle added later.
      for (const needle of READABLE_PLANTED_CLASSIFIERS) {
        const source = PLANTED_CLASSIFIERS[needle];
        assert.ok(source !== undefined, `${needle} is listed as readable and does not exist`);
        assert.ok(
          allSignals(signalsInSource(source)).length > 0,
          `${needle} parsed to no signals at all — the needle is broken, not the tree`,
        );
      }
    });

    it("sorts every needle into exactly one of the two lists, by name", () => {
      // This counted `readable + unreadable === total` and counting was all it
      // did: a needle renamed in one place kept the total, and a list naming a
      // key that no longer exists balanced against a key no list names. The
      // sets are what matter, so both directions are asserted — every needle
      // lands in exactly one list, and every listed name is a real needle.
      const readable = new Set(READABLE_PLANTED_CLASSIFIERS);
      const unreadable = new Set(Object.keys(UNREADABLE_PLANTED_CLASSIFIERS));
      for (const needle of Object.keys(PLANTED_CLASSIFIERS)) {
        assert.ok(
          readable.has(needle) !== unreadable.has(needle),
          readable.has(needle)
            ? `${needle} is listed as both readable and unreadable — it cannot be asserted to parse and to be refused`
            : `${needle} is in neither list, so it is checked by nothing — say whether the reader must parse it or refuse it`,
        );
      }
      for (const needle of [...readable, ...unreadable]) {
        assert.ok(
          Object.hasOwn(PLANTED_CLASSIFIERS, needle),
          `${needle} is listed but is not a needle — PLANTED_CLASSIFIERS has no such key, so the list is asserting over nothing`,
        );
      }
    });
  });

  it("calls everything else unavailable, which is the sentence that blames nobody", async () => {
    const { classifyStorageError } = await load();

    assert.equal(
      classifyStorageError(
        Object.assign(new Error("localStorage is not available"), { name: "SecurityError" }),
      ),
      "unavailable",
    );
    assert.equal(classifyStorageError(new Error("write failed")), "unavailable");
  });

  it("survives the values a catch block can actually receive", async () => {
    const { classifyStorageError } = await load();

    assert.equal(classifyStorageError(null), "unavailable");
    assert.equal(classifyStorageError(undefined), "unavailable");
    assert.equal(classifyStorageError("quota exceeded"), "full", "a thrown string is still a signal");
    assert.equal(classifyStorageError({ code: 22 }), "full");
  });

  it("tells the observer and Sentry the same thing, by construction", async () => {
    const { reportStorageFailure, observeStorageFailures } = await load();
    let observed: string | null = null;
    const unsubscribe = observeStorageFailures((event) => {
      observed = event.reason;
    });

    // The classification runs once and is passed to both, so these cannot
    // differ today. The case exists for the day somebody re-classifies at one
    // of the two call sites: the toast and the crash report would then disagree
    // about the same failure, and nothing else here would notice.
    reportStorageFailure("chat-context.setItem", "collectables-chats-v1", new Error("quota"));
    unsubscribe();

    assert.equal(observed, (captured[0].context as { extra: { reason: string } }).extra.reason);
    assert.equal(observed, "full");
  });

  it("agrees for every input the classifier reads, not for the one somebody picked", async () => {
    const {
      reportStorageFailure,
      observeStorageFailures,
      classifyStorageError,
      __resetStorageFailureReportsForTests,
    } = await load();

    // The case above proves the pair agrees for ONE error, which is what an
    // example can do. The claim its comment makes — "a second call site would
    // let them drift" — is a property over the classifier's whole input space,
    // and a drift introduced for the quota spellings alone (a `name` read at
    // one site and a `message` at the other) would pass it. Everything the
    // classifier is documented to read goes through both consumers here — from
    // the shared samples, which the case above ties to the classifier's own
    // signals, so a branch added to the classifier widens this loop rather than
    // slipping past a list somebody wrote by hand once.
    const inputs = STORAGE_ERROR_INPUTS;

    for (const [index, error] of inputs.entries()) {
      // One budget entry per input: the reporter reports a site/keyspace pair
      // once per session, so a shared key would leave every case after the
      // first asserting on an empty array.
      __resetStorageFailureReportsForTests();
      captured.length = 0;

      let observed: unknown = null;
      const unsubscribe = observeStorageFailures((event) => {
        observed = event.reason;
      });
      reportStorageFailure("chat-context.setItem", "collectables-chats-v1", error);
      unsubscribe();

      const sent = (captured[0]?.context as { extra?: { reason?: unknown } } | undefined)?.extra
        ?.reason;
      assert.equal(
        observed,
        sent,
        `input ${String(index)}: the toast said ${String(observed)} and the crash report said ${String(sent)}`,
      );
      assert.equal(
        sent,
        classifyStorageError(error),
        `input ${String(index)}: the event carries something other than the classifier's answer`,
      );
    }
  });

  it("hands the reason to every observer, beside the scope and the keyspace", async () => {
    const { reportStorageFailure, observeStorageFailures } = await load();
    const heard: { scope: string; keyspace: string; reason: string }[] = [];
    const unsubscribe = observeStorageFailures((event) => {
      heard.push({ scope: event.scope, keyspace: event.keyspace, reason: event.reason });
    });

    reportStorageFailure(
      "tombstones.setItem",
      TOMBSTONE_KEY,
      Object.assign(new Error("full"), { name: "QuotaExceededError" }),
    );
    unsubscribe();

    assert.deepEqual(heard, [
      {
        scope: "tombstones.setItem",
        keyspace: "collectables-tombstones-v1-items-{id}",
        reason: "full",
      },
    ]);
  });
});

// --- Adoption: the silent swallows this exists to end must not come back ---

describe("the swallowing storage sites route through the shared budget", () => {
  /**
   * The module each site names, by the convention `STORAGE_FAILURE_SITES`
   * states: the half before the dot is a module basename under `lib/`.
   *
   * Derived rather than tabulated. The hand-written `{module, scopes}` table
   * this replaces asserted each module's spelling against a list typed by the
   * same hand in the same hour — a copy of a typo rather than a check on one —
   * and it could not see the failure that matters here at all: an entry in the
   * union that nobody passes any more.
   */
  function moduleOf(site: string): string {
    const basename = site.slice(0, site.indexOf("."));
    const candidates = [`lib/${basename}.ts`, `lib/${basename}.tsx`];
    const found = candidates.filter((relative) => sourceFiles().includes(relative));
    assert.equal(
      found.length,
      1,
      `${site} names "${basename}", which is not exactly one module under lib/ (${found.join(", ") || "none"}) — the half before the dot is the module basename, by the convention STORAGE_FAILURE_SITES states`,
    );
    return found[0];
  }

  it("names at least the sites this tree has reasoned about", async () => {
    const { STORAGE_FAILURE_SITES } = await load();
    // A floor, not an equality: a site DELETED because its write went away is
    // a real outcome and should not fail here. A site quietly dropped from the
    // union while its module still swallows is caught by the sweep below.
    assert.ok(
      STORAGE_FAILURE_SITES.length >= 16,
      `only ${String(STORAGE_FAILURE_SITES.length)} sites are declared: ${STORAGE_FAILURE_SITES.join(", ")}`,
    );
    assert.equal(
      new Set(STORAGE_FAILURE_SITES).size,
      STORAGE_FAILURE_SITES.length,
      "a duplicated site is one budget entry under two spellings of the same name",
    );
  });

  it("every declared site is passed by exactly the module it names", async () => {
    const { STORAGE_FAILURE_SITES } = await load();
    // Both directions in one list, because a run where both are wrong should
    // show the whole answer: a site nobody passes is a write that stopped
    // reporting, and a site passed by the wrong module is a Sentry scope that
    // sends the reader to the wrong file.
    const problems: string[] = [];
    for (const site of STORAGE_FAILURE_SITES) {
      const expected = moduleOf(site);
      const call = new RegExp(`reportStorageFailure\\(\\s*"${site}"`);
      const passers = sourceFiles().filter((relative) => call.test(readSource(relative)));
      if (passers.length === 0) {
        problems.push(`declared, passed by nobody: ${site}`);
      } else if (passers.length > 1 || passers[0] !== expected) {
        problems.push(`${site} should be passed only by ${expected}, and is passed by: ${passers.join(", ")}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it("every module that reports declares its sites in the union", async () => {
    const { STORAGE_FAILURE_SITES } = await load();
    // The compiler already refuses an undeclared literal, so this is the half
    // it cannot state: a module reporting under a site whose NAME does not
    // match it — `reportStorageFailure("tombstones.setItem", …)` called from
    // `sync-cursors.ts` type-checks perfectly and points every crash report at
    // the wrong file.
    const declared = new Set<string>(STORAGE_FAILURE_SITES);
    const anyCall = /reportStorageFailure\(\s*"([^"]+)"/g;
    const problems: string[] = [];
    for (const relative of sourceFiles()) {
      const source = readSource(relative);
      for (let m = anyCall.exec(source); m !== null; m = anyCall.exec(source)) {
        const site = m[1];
        if (!declared.has(site)) problems.push(`${relative} passes an undeclared site: ${site}`);
        else if (moduleOf(site) !== relative) {
          problems.push(`${relative} reports as "${site}", which names ${moduleOf(site)}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  /**
   * Modules that write to AsyncStorage and deliberately declare no site.
   *
   * One entry, and it is the cycle: `storage-keys.ts` owns `storageKeyLabel`,
   * which `report-storage-failure` calls, so `migrateStorageKey` reporting
   * would close the loop. Its failure is also the mild kind — the old key
   * stays put and the next boot retries.
   */
  const WRITES_WITHOUT_A_SITE = ["lib/storage-keys.ts"];

  it("every module that writes to AsyncStorage either reports or is a named exception", () => {
    // THE JOINED QUESTION, and the one that found the hole. The write sweep
    // below asks "does anybody swallow a rejection into `.catch(() => …)`",
    // which is one SPELLING of swallowing: five modules wrapped their write in
    // `try { … } catch {}` instead, and a sixth (`i18n-context`) awaited it
    // bare under a `void` caller, making a failed write an unhandled rejection
    // rather than a swallowed one. All six were invisible to that rule and to
    // the site list alike, because neither asks about a module the other has
    // never heard of.
    //
    // Comments blanked, because this case's whole subject is the presence of a
    // CALL: `reportStorageFailure(` written in a doc block explaining why a
    // module does not report would satisfy the coarse half exactly backwards.
    const writes = /\bAsyncStorage\s*\.\s*(?:setItem|multiSet|mergeItem|multiMerge)\s*\(/;
    const reports = /reportStorageFailure\(/;
    const problems = sourceFiles()
      .filter((relative) => writes.test(sourceCode(relative)))
      .filter(
        (relative) =>
          !WRITES_WITHOUT_A_SITE.includes(relative) && !reports.test(sourceCode(relative)),
      );
    assert.deepEqual(
      problems,
      [],
      `these modules write to AsyncStorage and never report a failure, by any spelling: ${problems.join(", ")}`,
    );
  });

  it("the exception still writes, so the hole is still a hole in something", () => {
    // An exemption that stopped needing to be one is a hole standing open with
    // nothing about it looking stale.
    for (const relative of WRITES_WITHOUT_A_SITE) {
      assert.match(
        readSource(relative),
        /AsyncStorage\s*\.\s*setItem\s*\(/,
        `${relative} is excused from reporting a write it no longer makes — drop the entry`,
      );
    }
  });

  it("stays a leaf below storage-keys, which is why migrateStorageKey does NOT report", () => {
    // `storage-keys.ts` owns `storageKeyLabel`, which this module calls. Making
    // `migrateStorageKey` report would close the cycle, and a helper that
    // cannot be imported by the module defining its own input is worth more
    // than one report from a best-effort key rename. The migration's failure is
    // also the mild kind: the old key stays put and the next boot retries.
    const helper = readRepoFile("lib", "report-storage-failure.ts");
    assert.match(helper, /from "@\/lib\/storage-keys"/);
    assert.doesNotMatch(
      readRepoFile("lib", "storage-keys.ts"),
      /report-storage-failure/,
      "storage-keys.ts must not import the helper that imports it",
    );
  });

  /**
   * Each AsyncStorage write in `source`, reduced to THE ONE HANDLER ITS
   * REJECTION REACHES, one per line.
   *
   * ## The subject is a write, not a file
   *
   * A false positive this rule shipped with for exactly one commit. A regex
   * bridging from `AsyncStorage.setItem(` to a `.catch(() => undefined)` over
   * a bounded window of source will happily start at a write that reports
   * correctly and finish at an unrelated promise four lines below — reading, to
   * whoever meets the failure, as "this module swallows a write" while pointing
   * at a module that does not.
   *
   * ## Two spellings of swallowing, and why one rule now covers both
   *
   * `.catch(() => …)` is one spelling, and the six writes the shipped rule
   * could not see were the other: five wrapped the write in
   * `try { … } catch {}`, which no pattern anchored to the call's tail can
   * reach, and a sixth awaited it bare under a `void` caller. They were found
   * by the module-level case above, which is coarse on purpose — a module that
   * reports SOMEWHERE passes it, so `social-context`'s three writes are covered
   * by one reporting call and a second write there could go silent without
   * anything going red. Neither half subsumed the other. This is the merge.
   *
   * ## Which handler, and why exactly one
   *
   * A rejection is handled once, by the first thing that catches it, so the
   * reader resolves that one handler rather than emitting every candidate:
   *
   *   - A `.catch(…)` ANYWHERE IN THE WRITE'S OWN CHAIN wins. `await
   *     AsyncStorage.setItem(…).catch(report)` inside an unrelated
   *     `try { … } catch {}` is `marketplace-context`'s cloud-first load, and
   *     it is correct: the chained handler runs, the await resolves, and the
   *     enclosing clause never sees the storage error. Emitting the enclosing
   *     clause too flagged that module on the first draft of this rule.
   *   - Otherwise the INNERMOST enclosing `catch`, because an inner clause that
   *     reports is not undone by an outer one that does not, and an inner one
   *     that swallows means the outer never runs. A `try`/`finally` with no
   *     catch contributes nothing and the search continues outward, which is
   *     what re-raising through it does.
   *   - Otherwise nothing, which is the UNHANDLED case (`i18n-context`'s bug
   *     before this week) and is a different offence with a different fix.
   *     Only the module-level case sees it today; filed as a follow-up.
   *
   * Every span is read to its own closing bracket by `balancedEnd`, so no
   * character count decides an answer and no window bridges two statements. An
   * unclosed call contributes no line at all rather than a truncated one — a
   * span read short is a span whose offence was not seen, which is the silent
   * direction for a sweep asserting an absence.
   */
  function writeHandlers(source: string): string {
    const lines: string[] = [];
    for (const call of storageCalls(source, WRITE_METHODS)) {
      // One line per write, whitespace flattened, so a rule anchored with
      // `^`/`m` sees one handler and `.` cannot run past its end.
      if (call.handler !== null) {
        lines.push(`${HANDLER_MARK}${call.handler.replace(/\s+/g, " ")}`);
      }
    }
    return lines.join("\n");
  }

  const WRITE_METHODS = "setItem|multiSet|mergeItem|multiMerge";

  /** Every AsyncStorage method, for the sweep that is about the CHAIN. */
  const EVERY_METHOD = `${WRITE_METHODS}|removeItem|multiRemove|getItem|multiGet|getAllKeys`;

  /**
   * Each AsyncStorage call in `source`, with the handler its rejection reaches.
   *
   * The walk both sweeps share. Written once because they differ only in which
   * methods they ask about and what they do with the answer — the swallow sweep
   * reads the handler's TEXT, the unhandled sweep reads whether there is one.
   */
  function* storageCalls(
    source: string,
    methods: string,
  ): Generator<{ readonly call: string; readonly handler: string | null }> {
    // Built per call rather than hoisted: `offence-sweep` refuses a `g`-flagged
    // rule for the reason this needs to be careful too — a shared `lastIndex`
    // between files skips whole modules.
    const pattern = new RegExp(`\\bAsyncStorage\\s*\\.\\s*(?:${methods})\\s*\\(`, "g");
    for (let m = pattern.exec(source); m !== null; m = pattern.exec(source)) {
      const closeAt = balancedEnd(source, m.index + m[0].length - 1, "(", ")");
      if (closeAt === null) continue;
      yield {
        call: m[0].replace(/\s+/g, ""),
        handler: chainedCatch(source, closeAt + 1) ?? innermostCatchAround(source, m.index),
      };
    }
  }

  /**
   * Each AsyncStorage call, labelled `handled` or `unhandled`.
   *
   * THE THIRD SHAPE, and the one the swallow rule is silent about by
   * construction: a rejection with no handler at all is not swallowed, it is
   * UNHANDLED — a redbox in dev and a logged error nobody reads in production.
   * `i18n-context.setLanguage` was this until this week, and on the day this
   * sweep was written four more were: `i18n-context`'s hydrate ended its chain
   * at a `.finally` (which handles nothing), and `chat-context` and
   * `social-context` each ran their hydrate inside a `try`/`finally` (which
   * also handles nothing) under a `void hydrate(...)` caller. The likeliest
   * rejection of the four was not even the store — `social-context` awaited
   * `fetchFriendRequests` in the same `Promise.all`, so an OFFLINE sign-in
   * produced an unhandled rejection on every mount.
   *
   * Over every AsyncStorage method, not just the writes, because the reads were
   * where four of the five lived. Whether a handled-but-silent READ is an
   * offence is a separate question this rule does not touch: it asks only
   * whether anything catches.
   */
  function callHandling(source: string): string {
    return [...storageCalls(source, EVERY_METHOD)]
      .map((c) => `${CALL_MARK}${c.handler === null ? "unhandled" : "handled"} ${c.call}`)
      .join("\n");
  }

  /**
   * The argument text of the `.catch(…)` in the method chain starting at
   * `from`, or null when the chain has none.
   *
   * Each link is read to its own closing parenthesis and the walk continues
   * from there, so `.then(…).catch(…)` finds the second link and a `.catch` on
   * an unrelated statement below is not in the chain at all. The walk stops at
   * the first thing that is not `.identifier(` — the `;` or the identifier
   * beginning the next statement.
   */
  function chainedCatch(source: string, from: number): string | null {
    for (let at = from; ; ) {
      const link = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(source.slice(at));
      if (link === null) return null;
      const open = at + link[0].length - 1;
      const args = balancedInner(source, open, "(", ")");
      if (args === null) return null;
      if (link[1] === "catch") return args;
      at = open + args.length + 2;
    }
  }

  /**
   * The body of the innermost `catch` clause whose `try` block contains `at`,
   * or null when nothing catches there.
   *
   * Walked outermost-in: every `try {` before `at` whose balanced block reaches
   * past it encloses it, and the LAST such one is the innermost. A `try` whose
   * block closes before `at` is a sibling above the write and contributes
   * nothing, which is the false attribution this shape exists to refuse.
   */
  function innermostCatchAround(source: string, at: number): string | null {
    const tryBlock = /\btry\s*\{/g;
    let innermost: string | null = null;
    for (let m = tryBlock.exec(source); m !== null && m.index < at; m = tryBlock.exec(source)) {
      const blockEnd = balancedEnd(source, m.index + m[0].length - 1, "{", "}");
      if (blockEnd === null || blockEnd < at) continue;
      const clause = /^\s*catch\s*(?:\([^)]*\)\s*)?\{/.exec(source.slice(blockEnd + 1));
      if (clause === null) continue;
      const body = balancedInner(source, blockEnd + clause[0].length, "{", "}");
      if (body !== null) innermost = body;
    }
    return innermost;
  }

  /** Opens each handler line, so the rule below can anchor to one handler. */
  const HANDLER_MARK = "«handler»";

  /** Opens each call line for the unhandled sweep. */
  const CALL_MARK = "«call»";

  /** The other rule, held by name for the same reason {@link SWALLOWED_WRITE} is. */
  const UNHANDLED_CALL = new RegExp(`^${CALL_MARK}unhandled `, "m");

  /**
   * The rule, named so a positive control can hold it. A sweep asserting
   * "nothing matches" is satisfied perfectly by a pattern that has STOPPED
   * matching, and a clean tree looks identical either way — there is no file
   * left in this repo to control against, so the controls are fabricated.
   *
   * ONE PATTERN FOR BOTH SPELLINGS, because once the reader has resolved which
   * handler runs, the two spellings ask the same question of it: does anything
   * in there report? That is stricter than the `() => undefined` / `() => {}`
   * pattern it replaces — `.catch((error) => console.warn(error))` is a handler
   * that is not empty and reports nothing, which the old shape read as
   * innocent — and it is the same claim the enclosing-clause half has to make,
   * since a real clause is never empty (every one in this tree carries the
   * comment saying why the failure is survivable).
   *
   * The absence is phrased inside ONE LINE: `.` does not cross a newline
   * without the `s` flag and each handler was flattened above, so a report in
   * the NEXT write's handler cannot vouch for this one.
   */
  const SWALLOWED_WRITE = new RegExp(`^${HANDLER_MARK}(?!.*reportStorageFailure\\()`, "m");

  function swallows(source: string): boolean {
    return SWALLOWED_WRITE.test(writeHandlers(source));
  }

  it("the swallowed-write rule still matches a chained catch that reports nothing", () => {
    for (const offender of [
      "AsyncStorage.setItem(key, body).catch(() => undefined);",
      "AsyncStorage.setItem(key, body).catch(() => {});",
      "await AsyncStorage.setItem(MARKETPLACE_KEY, JSON.stringify(cloud)).catch(() => undefined);",
      "AsyncStorage.setItem(\n  KEY,\n  JSON.stringify({ a, b }),\n).catch(() => undefined);",
      "AsyncStorage.setItem(k, v).catch(\n  () => undefined,\n);",
      'AsyncStorage.setItem(k, ")").catch(() => undefined);',
      "AsyncStorage.multiSet(pairs).catch(() => undefined);",
      // Not empty, and reports nothing — the shape the `() => undefined` /
      // `() => {}` pattern read as innocent. A `console.warn` is invisible in
      // production and identical to a swallow from Sentry's side.
      "AsyncStorage.setItem(k, v).catch((error: unknown) => console.warn(error));",
      // Further down the chain, which a rule anchored to the call's tail sees
      // only by accident of how many characters the `.then` took up.
      "AsyncStorage.setItem(k, v).then(noop).catch(() => undefined);",
    ]) {
      assert.ok(swallows(offender), `must flag: ${offender}`);
    }
  });

  it("the swallowed-write rule leaves a reporting write alone", () => {
    // The negative side, so a rule widened until everything matches fails here
    // instead of making the sweep unanimous about a tree it stopped reading.
    for (const innocent of [
      'AsyncStorage.setItem(key, body).catch((error: unknown) => {\n  reportStorageFailure("s", key, error);\n});',
      'AsyncStorage.setItem(k, v).then(noop).catch((error: unknown) => {\n  reportStorageFailure("s", k, error);\n});',
      "AsyncStorage.getItem(key).catch(() => undefined);",
      "somethingElse(key).catch(() => undefined);",
      // No handler at all is the UNHANDLED case, not this rule's offence: the
      // rejection escapes to the caller, which may well be handling it. It is
      // the module-level case above that has an opinion, and the reason this
      // rule does not yet subsume that one.
      "await AsyncStorage.setItem(key, body);",
    ]) {
      assert.ok(!swallows(innocent), `must not flag: ${innocent}`);
    }
  });

  it("does not bridge from a reporting write to somebody else's empty catch", () => {
    // The case the shipped rule failed. A bounded `[\s\S]{0,400}?` window
    // starting at the reporting `setItem` reaches the `.catch(() => undefined)`
    // below it, and the module named in the failure is not the one that
    // offends. Both statements here are legitimate.
    const source = [
      'AsyncStorage.setItem(key, JSON.stringify(value)).catch((error: unknown) => {',
      '  reportStorageFailure("some-context.setItem", key, error);',
      "});",
      "",
      "// A remote write, which is a different rule's business entirely.",
      "softDeleteRemoteItem(itemId).catch(() => undefined);",
    ].join("\n");
    assert.ok(!swallows(source), "the chain of the write ends at the write");
  });

  it("does not read past an unclosed call into the next statement", () => {
    // The other direction of the same anchoring: a write whose parenthesis
    // never closes contributes no line, so the `.catch` of a LATER statement
    // cannot be attributed to it.
    const source = 'AsyncStorage.setItem(key, "unterminated\nfoo().catch(() => undefined);';
    assert.ok(!swallows(source), "an unreadable call is skipped, not guessed at");
  });

  it("reads each write's handler separately, so one report cannot vouch for two writes", () => {
    // The reason the absence is phrased inside one line. Both writes are in
    // one module and only one of them reports; a rule asking the question of
    // the whole file — which the coarse module-level case above does — passes
    // this exactly as it passes a module where both report.
    const source = [
      'AsyncStorage.setItem(a, one).catch((error: unknown) => {',
      '  reportStorageFailure("x.setItem", a, error);',
      "});",
      "AsyncStorage.setItem(b, two).catch(() => undefined);",
    ].join("\n");
    assert.ok(swallows(source), "the second write is swallowed whatever the first one does");
  });

  it("matches the OTHER spelling: a write wrapped in a try whose catch reports nothing", () => {
    // The five writes the `.catch` rule could not see, in the shapes they were
    // actually written in. `catch {}` with no binding is the one the tree still
    // contains (in the sanctioned exemption); the others are how a new one
    // would arrive.
    for (const offender of [
      "try {\n  await AsyncStorage.setItem(key, value);\n} catch {\n  best effort\n}",
      "try {\n  await AsyncStorage.setItem(key, value);\n} catch (error: unknown) {\n  console.warn(error);\n}",
      "try {\n  await AsyncStorage.multiSet(pairs);\n} catch {}",
      // Reported, but not through the shared budget — one full disk becomes a
      // stream of events, which is the outcome `reportStorageFailure` exists
      // to prevent, so the direct call is not a substitute for it.
      "try {\n  await AsyncStorage.setItem(key, value);\n} catch (error: unknown) {\n  captureException(error);\n}",
    ]) {
      assert.ok(swallows(offender), `must flag: ${offender}`);
    }
  });

  it("lets the write's own chained catch answer for it, inside an unrelated try", () => {
    // `marketplace-context`'s cloud-first load, which the first draft of this
    // rule flagged. The chained handler runs, the `await` resolves, and the
    // enclosing clause — which is about a corrupt JSON cache, a different
    // failure with a different recovery — never sees the storage error.
    const source = [
      "try {",
      "  const cloud = await cloudFetchListings();",
      "  await AsyncStorage.setItem(KEY, JSON.stringify(cloud)).catch((error: unknown) => {",
      '    reportStorageFailure("marketplace-context.setItem", KEY, error);',
      "  });",
      "} catch {",
      "  start fresh rather than crashing the provider",
      "}",
    ].join("\n");
    assert.ok(!swallows(source), "the chained handler is the one that runs");
  });

  it("leaves a write whose enclosing catch reports alone", () => {
    for (const innocent of [
      'try {\n  await AsyncStorage.setItem(key, value);\n} catch (error: unknown) {\n  reportStorageFailure("locale-helpers.setItem", key, error);\n}',
      // A `finally` catches nothing, so the search continues outward and finds
      // the clause that does. Attributing the write to the inner `try` would
      // report a module that reports correctly.
      'try {\n  try {\n    await AsyncStorage.setItem(key, value);\n  } finally {\n    done();\n  }\n} catch (error: unknown) {\n  reportStorageFailure("x.setItem", key, error);\n}',
      // The innermost clause is the one that runs, so an outer swallow below a
      // reporting inner one is not this write's problem.
      'try {\n  try {\n    await AsyncStorage.setItem(key, value);\n  } catch (error: unknown) {\n    reportStorageFailure("x.setItem", key, error);\n  }\n} catch {}',
    ]) {
      assert.ok(!swallows(innocent), `must not flag: ${innocent}`);
    }
  });

  it("does not attribute a write to a try/catch that closed above it", () => {
    // The enclosing-catch half of the same anchoring the tail half needed. A
    // sibling `try { … } catch {}` earlier in the file catches nothing here,
    // and reading it as this write's handler would name a module whose write
    // reports perfectly well.
    const source = [
      "try {\n  await somethingElse();\n} catch {}",
      "",
      'AsyncStorage.setItem(key, value).catch((error: unknown) => {',
      '  reportStorageFailure("some-context.setItem", key, error);',
      "});",
    ].join("\n");
    assert.ok(!swallows(source), "a try that closed before the write does not enclose it");
  });

  it("reads each handler whole, so a long body cannot hide the report", () => {
    // Every span this reader takes is bounded by its own closing bracket rather
    // than by a character count, which is what lets a comment-heavy clause
    // (every real one in this tree is) report the same as a terse one. The
    // shipped rule's `[\s\S]{0,400}?` window is the thing this replaces.
    const padding = "  doSomething();\n".repeat(60);
    const source = `try {\n  await AsyncStorage.setItem(key, value);\n} catch (error: unknown) {\n${padding}  reportStorageFailure("x.setItem", key, error);\n}`;
    assert.ok(!swallows(source), "the whole clause is the subject, not its first N characters");
  });

  it("no AsyncStorage write is swallowed, by either spelling", () => {
    // The sweep, rather than eight source assertions: a NINTH provider is what
    // the per-module list cannot see. A write whose rejection reaches a handler
    // that reports nothing is silent local data loss, and the user finds out on
    // the next launch when their edits are gone.
    //
    // Read through `sourceCode` rather than `readSource`: a `.catch(() =>
    // undefined)` quoted in a doc block is not an offence, and — the direction
    // that would have mattered here — a `reportStorageFailure(` NAMED in a
    // comment inside a catch clause is not a report, which is exactly what the
    // real clauses in this tree are full of.
    assertNoOffenders({
      rule: SWALLOWED_WRITE,
      files: sourceFiles(),
      read: (relative) => writeHandlers(sourceCode(relative)),
      exempt: WRITES_WITHOUT_A_SITE,
      subject: "modules",
      what: "swallow a rejected AsyncStorage write — into a chained `.catch`, or into the `try`/`catch` around it — that never calls reportStorageFailure(scope, key, error)",
    });
  });

  /**
   * Modules whose AsyncStorage rejections deliberately reach their CALLER.
   *
   * `getAllCollectablesKeys` and `clearAllUserData` are exported async helpers
   * with no state of their own: the dev-menu screen that calls them is where a
   * failed wipe should surface, and catching here would hand it a silent
   * success. `migrateStorageKey` in the same file has its own `catch`, so this
   * is about the file's other three calls.
   */
  const CALLS_THAT_PROPAGATE = ["lib/storage-keys.ts"];

  function unhandled(source: string): boolean {
    return UNHANDLED_CALL.test(callHandling(source));
  }

  it("the unhandled rule matches every chain that ends without a catch", () => {
    for (const offender of [
      // The four found the day this rule was written.
      "AsyncStorage.getItem(KEY).then(apply).finally(() => setReady(true));",
      "try {\n  const raw = await AsyncStorage.getItem(key);\n  setStore(parse(raw));\n} finally {\n  setReady(true);\n}",
      "const [a, b] = await Promise.all([AsyncStorage.getItem(x), fetchThings()]);",
      "await AsyncStorage.setItem(KEY, next);",
      // Not a write, and just as unhandled.
      "await AsyncStorage.multiRemove(keys);",
    ]) {
      assert.ok(unhandled(offender), `must flag: ${offender}`);
    }
  });

  it("the unhandled rule leaves a caught chain alone, however it catches", () => {
    for (const innocent of [
      "AsyncStorage.getItem(KEY).catch(() => null);",
      "AsyncStorage.getItem(KEY).then(apply).catch(report).finally(done);",
      "try {\n  await AsyncStorage.getItem(key);\n} catch {\n  nothing\n}",
      // Silent, and this rule has no opinion about that — `SWALLOWED_WRITE`
      // does, for writes. Two rules, two questions, one reader.
      "AsyncStorage.getItem(KEY).catch(() => undefined);",
      "somethingElse().finally(done);",
    ]) {
      assert.ok(!unhandled(innocent), `must not flag: ${innocent}`);
    }
  });

  it("no AsyncStorage rejection is left without a handler", () => {
    // A `.finally` handles nothing and a `try`/`finally` handles nothing, which
    // is what made this class survive four rules about swallowing: an unhandled
    // rejection is not a swallowed one, and every sweep here was looking for a
    // catch that did too little rather than for the absence of one.
    assertNoOffenders({
      rule: UNHANDLED_CALL,
      files: sourceFiles(),
      read: (relative) => callHandling(sourceCode(relative)),
      exempt: CALLS_THAT_PROPAGATE,
      subject: "modules",
      what: "let an AsyncStorage rejection escape with no handler anywhere — a `.finally` and a `try`/`finally` both handle nothing, so add a `.catch` or a `catch` and report it through reportStorageFailure(scope, key, error)",
    });
  });

  it("the propagating exemption still propagates, so it is a decision rather than a leftover", () => {
    for (const relative of CALLS_THAT_PROPAGATE) {
      assert.ok(
        unhandled(sourceCode(relative)),
        `${relative} now catches every AsyncStorage rejection — drop it from CALLS_THAT_PROPAGATE rather than exempting a module that has stopped needing it`,
      );
    }
  });

  it("the exemption is still an offender, so it is a hole rather than a habit", () => {
    // `assertExemptionsHonest` asks this of a named list, and the honesty case
    // above asks the weaker half — that `storage-keys.ts` still WRITES. It
    // could write and report and still sit here, at which point the entry is a
    // hole nobody closed. Asking the sweep's own rule is the difference.
    for (const relative of WRITES_WITHOUT_A_SITE) {
      assert.ok(
        swallows(sourceCode(relative)),
        `${relative} no longer swallows its write — drop it from WRITES_WITHOUT_A_SITE rather than exempting a module that has stopped offending`,
      );
    }
  });

});
