import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { assertNoOffenders, matchesRule } from "./helpers/offence-sweep";
import { installNativeModuleStubs, mockModule } from "./helpers/render";
import { readRepoFile } from "./helpers/repo-file";
import { readSource, sourceFiles } from "./helpers/source-files";

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

const captured: { error: unknown; context: unknown }[] = [];

mockModule("@/lib/sentry", {
  captureException: (error: unknown, context: unknown) => captured.push({ error, context }),
});

/** A real per-user key: every builder in `storage-keys.ts` ends in the auth id. */
const AUTH_ID = "11111111-2222-4333-8444-555555555555";
const ITEMS_KEY = `collectables-items-v1-${AUTH_ID}`;
const TOMBSTONE_KEY = `collectables-tombstones-v1-items-${AUTH_ID}`;

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
    assert.deepEqual(captured[0].context, {
      scope: "tombstones.setItem",
      extra: { keyspace: "collectables-tombstones-v1-items-{id}" },
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
    const { reportStorageFailure } = await load();
    assert.equal(reportStorageFailure("a-b", "c", 1), true);
    assert.equal(reportStorageFailure("a", "b-c", 2), true);
    assert.equal(captured.length, 2);
  });

  it("keeps a key with no per-user half intact", async () => {
    const { reportStorageFailure } = await load();
    reportStorageFailure("use-persisted-blob.setItem", "collectables-language-v1", 1);
    assert.deepEqual((captured[0].context as { extra: unknown }).extra, {
      keyspace: "collectables-language-v1",
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

// --- Adoption: the silent swallows this exists to end must not come back ---

describe("the swallowing storage sites route through the shared budget", () => {
  const ADOPTERS = [
    { module: "lib/use-persisted-blob.ts", scopes: ["use-persisted-blob.setItem"] },
    { module: "lib/tombstones.ts", scopes: ["tombstones.getItem", "tombstones.setItem"] },
    { module: "lib/sync-cursors.ts", scopes: ["sync-cursors.getItem", "sync-cursors.setItem"] },
    { module: "lib/chat-context.tsx", scopes: ["chat-context.setItem"] },
    { module: "lib/premium-context.tsx", scopes: ["premium-context.setItem"] },
    { module: "lib/marketplace-context.tsx", scopes: ["marketplace-context.setItem"] },
    { module: "lib/social-context.tsx", scopes: ["social-context.setItem"] },
    { module: "lib/diagnostics-context.tsx", scopes: ["diagnostics-context.setItem"] },
  ] as const;

  for (const { module, scopes } of ADOPTERS) {
    it(`${module} imports the helper and names each site`, () => {
      const [dir, file] = module.split("/");
      const source = readRepoFile(dir, file);
      assert.match(
        source,
        /import \{ reportStorageFailure \} from "@\/lib\/report-storage-failure"/,
        `${module} must not grow a second copy of the once-per-keyspace budget`,
      );
      for (const scope of scopes) {
        assert.match(
          source,
          new RegExp(`reportStorageFailure\\(\\s*"${scope}"`),
          `${module} must report ${scope} — a silent catch here is the failure this module exists for`,
        );
      }
    });
  }

  /** The private budget the shared one replaces, named so the sweep can be policed. */
  const PRIVATE_BUDGET = /reportedKeyspaces/;

  it("nothing keeps its own reported-keyspace Set", () => {
    // The floor the shared budget replaces: `use-persisted-blob.ts` held the
    // only one, and a second module growing its own is how one full disk
    // starts reporting once per module again.
    assertNoOffenders({
      rule: PRIVATE_BUDGET,
      files: sourceFiles(),
      read: readSource,
      subject: "modules",
      what: "keep a private report budget — import reportStorageFailure instead, so one full device store is one fact rather than one per module that noticed it",
    });
  });

  /**
   * The rule the sweep below is built on, named so a positive control can hold
   * it. A sweep asserting "nothing matches" is satisfied perfectly by a pattern
   * that has STOPPED matching, and a clean tree looks identical either way —
   * there is no file left in this repo to control against, so the control is a
   * fabricated one.
   */
  const SWALLOWED_WRITE =
    /AsyncStorage\.setItem\([\s\S]{0,400}?\)\s*\.?\s*catch\(\s*\(\s*\)\s*=>\s*(undefined|\{\s*\})\s*[,)]/;

  it("the swallowed-write rule still matches a swallowed write", () => {
    for (const offender of [
      "AsyncStorage.setItem(key, body).catch(() => undefined);",
      "AsyncStorage.setItem(key, body).catch(() => {});",
      "await AsyncStorage.setItem(MARKETPLACE_KEY, JSON.stringify(cloud)).catch(() => undefined);",
      "AsyncStorage.setItem(\n  KEY,\n  JSON.stringify({ a, b }),\n).catch(() => undefined);",
      "AsyncStorage.setItem(k, v).catch(\n  () => undefined,\n);",
    ]) {
      assert.ok(matchesRule(SWALLOWED_WRITE, offender), `must flag: ${offender}`);
    }
  });

  it("the swallowed-write rule leaves a reporting write alone", () => {
    // The negative side, so a rule widened until everything matches fails here
    // instead of making the sweep unanimous about a tree it stopped reading.
    for (const innocent of [
      'AsyncStorage.setItem(key, body).catch((error: unknown) => {\n  reportStorageFailure("s", key, error);\n});',
      "AsyncStorage.getItem(key).catch(() => undefined);",
      "somethingElse(key).catch(() => undefined);",
      "await AsyncStorage.setItem(key, body);",
    ]) {
      assert.ok(!matchesRule(SWALLOWED_WRITE, innocent), `must not flag: ${innocent}`);
    }
  });

  it("no AsyncStorage write is swallowed into an empty catch any more", () => {
    // The sweep, rather than eight source assertions: a NINTH provider is what
    // the per-module list cannot see. A `setItem` whose rejection reaches
    // `() => undefined` or `() => {}` is silent local data loss, and the user
    // finds out on the next launch when their edits are gone.
    assertNoOffenders({
      rule: SWALLOWED_WRITE,
      files: sourceFiles(),
      read: readSource,
      subject: "modules",
      what: "swallow a rejected AsyncStorage.setItem into an empty catch — bind the error and report it through reportStorageFailure(scope, key, error)",
    });
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
});
