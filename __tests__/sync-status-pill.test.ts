import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PENDING_UPSERT_GROUP,
  countPendingUpserts,
  enqueueUpsert,
  type PendingUpsertQueue,
} from "@/lib/pending-upserts";
import { countPendingSocial } from "@/lib/pending-social";

/**
 * BE-16: the "syncing…" pending-mutations pill. The pure count helpers are
 * exercised directly; the React component + context wiring (which pull in
 * react-native peers and can't execute under node-tests) are pinned
 * structurally — same pattern as the realtime-status tests.
 */

interface Row {
  id: string;
  text: string;
}

const getId = (r: Row) => r.id;
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";

describe("countPendingUpserts (BE-16)", () => {
  it("returns 0 for an empty queue", () => {
    assert.equal(countPendingUpserts<Row>({}), 0);
  });

  it("counts entities in the single fixed group", () => {
    let q: PendingUpsertQueue<Row> = {};
    q = enqueueUpsert(q, { id: A, text: "a" }, getId);
    q = enqueueUpsert(q, { id: B, text: "b" }, getId);
    assert.equal(countPendingUpserts(q), 2);
  });

  it("de-dupes a re-queued id (latest-wins, single entry)", () => {
    let q: PendingUpsertQueue<Row> = {};
    q = enqueueUpsert(q, { id: A, text: "v1" }, getId);
    q = enqueueUpsert(q, { id: A, text: "v2" }, getId);
    assert.equal(countPendingUpserts(q), 1);
  });

  it("sums across every group (multi-group chat-style queue)", () => {
    const q: PendingUpsertQueue<Row> = {
      chatA: [{ id: A, text: "a" }],
      chatB: [{ id: B, text: "b1" }, { id: A, text: "b2" }],
    };
    assert.equal(countPendingUpserts(q), 3);
  });

  it("ignores an explicitly-empty group", () => {
    const q: PendingUpsertQueue<Row> = { [PENDING_UPSERT_GROUP]: [] };
    assert.equal(countPendingUpserts(q), 0);
  });
});

describe("countPendingSocial (BE-16)", () => {
  it("delegates to countPendingUpserts over the social queue", () => {
    assert.equal(countPendingSocial({}), 0);
    assert.equal(
      countPendingSocial({ [PENDING_UPSERT_GROUP]: [{ op: "send-request" } as never] }),
      1,
    );
  });
});

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("SyncStatusPill component (components/sync-status-pill.tsx)", () => {
  const src = read("components/sync-status-pill.tsx");

  it("exports the SyncStatusPill component", () => {
    assert.match(src, /export\s+function\s+SyncStatusPill\(/);
  });

  it("sums the pending count from all three write contexts", () => {
    assert.match(src, /pendingSyncCount:\s*collectionsPending\s*\}\s*=\s*useCollections\(\)/);
    assert.match(src, /pendingSyncCount:\s*socialPending\s*\}\s*=\s*useSocial\(\)/);
    assert.match(src, /pendingSyncCount:\s*chatPending\s*\}\s*=\s*useChat\(\)/);
    assert.match(src, /collectionsPending\s*\+\s*socialPending\s*\+\s*chatPending/);
  });

  it("renders nothing when there is no pending work", () => {
    assert.match(src, /if\s*\(total\s*<=\s*0\)\s*return\s+null/);
  });

  it("renders the localised syncing copy with the live count", () => {
    assert.match(src, /t\("syncingPill",\s*\{\s*count:\s*total\s*\}\)/);
  });
});

describe("SyncStatusPill wiring", () => {
  it("each write context exposes a pendingSyncCount", () => {
    assert.match(read("lib/collections-context.tsx"), /pendingSyncCount:\s*number/);
    assert.match(read("lib/social-context.tsx"), /pendingSyncCount:\s*number/);
    assert.match(read("lib/chat-context.tsx"), /pendingSyncCount:\s*number/);
  });

  it("collections sums both upsert queues into pendingSyncCount", () => {
    assert.match(
      read("lib/collections-context.tsx"),
      /pendingSyncCount:\s*countPendingUpserts\(pendingCollections\)\s*\+\s*countPendingUpserts\(pendingItems\)/,
    );
  });

  it("chat derives pendingSyncCount from the per-chat pending map", () => {
    assert.match(
      read("lib/chat-context.tsx"),
      /countPendingUpserts\(store\.pendingByChatId\)/,
    );
  });

  it("_layout renders the SyncStatusPill inside the app shell", () => {
    const layout = read("app/_layout.tsx");
    assert.match(layout, /import\s+\{\s*SyncStatusPill\s*\}\s+from\s+"@\/components\/sync-status-pill"/);
    assert.match(layout, /<SyncStatusPill\s*\/>/);
  });

  it("ships the syncingPill i18n key (en + ru)", () => {
    const i18n = read("lib/i18n-context.tsx");
    assert.match(i18n, /syncingPill:\s*\(params\?:/);
    assert.match(i18n, /Синхронизация/);
  });
});
