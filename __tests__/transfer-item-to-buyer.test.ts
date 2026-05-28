import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  acquiredItemId,
  acquiredItemSlug,
  planTransferItem,
  type TransferItemInput,
} from "@/lib/transfer-item-helpers";
import type {
  AcquiredCollectionOptions,
  AcquiredItemSnapshot,
  TransferSource,
} from "@/lib/transfer-item-types";
import type { CollectableItem, Collection } from "@/lib/types";

const FROZEN_NOW = new Date("2026-05-28T12:00:00.000Z");

const SOURCE: TransferSource = {
  listingId: "listing-42",
  listingCreatedAt: "2026-05-01T08:00:00.000Z",
  sellerUserId: "seller-u-7",
  mode: "sell",
  price: 199,
  currency: "USD",
};

const TAG_RARE = { label: "rare", color: "#d89c5b" };
const TAG_VINTAGE = { label: "vintage", color: "#3a7d4f" };
const TAG_LIMITED = { label: "limited", color: "#c44" };
const TAG_SIGNED = { label: "signed", color: "#48a" };

function makeSnapshot(over: Partial<AcquiredItemSnapshot> = {}): AcquiredItemSnapshot {
  return {
    title: "Vintage Comic Book #1",
    photos: ["https://cdn/photo-a.jpg", "https://cdn/photo-b.jpg"],
    description: "First-edition condition",
    cost: 199,
    acquiredFrom: "@seller7",
    condition: "good",
    tags: [TAG_RARE, TAG_VINTAGE],
    ...over,
  };
}

function baseInput(over: Partial<TransferItemInput> = {}): TransferItemInput {
  return {
    snapshot: makeSnapshot(),
    ownerUserId: "buyer-u-1",
    ownerName: "buyer@example.com",
    existingCollection: undefined,
    existingItems: [],
    now: FROZEN_NOW,
    ...over,
  };
}

describe("acquiredItemSlug", () => {
  it("lower-cases and dash-separates ASCII words", () => {
    assert.equal(acquiredItemSlug("Vintage Comic Book #1"), "vintage-comic-book-1");
  });

  it("falls back to a stable 'acquired' slug on blank / non-ASCII-only input", () => {
    assert.equal(acquiredItemSlug(""), "acquired");
    assert.equal(acquiredItemSlug("   "), "acquired");
    assert.equal(acquiredItemSlug("漢字"), "acquired");
  });
});

describe("acquiredItemId", () => {
  it("derives a deterministic id from the source transferLogEntryId when supplied", () => {
    const id = acquiredItemId(makeSnapshot(), SOURCE, FROZEN_NOW.getTime());
    // Same source must always produce the same id — idempotency dep.
    const idAgain = acquiredItemId(makeSnapshot(), SOURCE, FROZEN_NOW.getTime() + 9999);
    assert.equal(id, idAgain);
    assert.match(id, /^acq-vintage-comic-book-1-listing-42-/);
  });

  it("falls back to a per-call timestamp when no source is supplied", () => {
    const id1 = acquiredItemId(makeSnapshot(), undefined, 1000);
    const id2 = acquiredItemId(makeSnapshot(), undefined, 2000);
    assert.notEqual(id1, id2);
    assert.match(id1, /^acq-vintage-comic-book-1-1000$/);
    assert.match(id2, /^acq-vintage-comic-book-1-2000$/);
  });
});

describe("planTransferItem", () => {
  it("(c) carries the snapshot's condition and tags onto the new item verbatim", () => {
    const plan = planTransferItem(
      baseInput({
        snapshot: makeSnapshot({ condition: "excellent", tags: [TAG_LIMITED, TAG_SIGNED] }),
      }),
    );
    assert.equal(plan.isDuplicate, false);
    assert.equal(plan.item.condition, "excellent");
    assert.deepEqual(plan.item.tags, [TAG_LIMITED, TAG_SIGNED]);
  });

  it("(b) sets newCollection.coverPhoto to snapshot.photos[0] on first transfer", () => {
    const plan = planTransferItem(baseInput());
    assert.ok(plan.newCollection, "first transfer must produce a newCollection");
    assert.equal(plan.newCollection!.coverPhoto, "https://cdn/photo-a.jpg");
    assert.equal(plan.newCollection!.id, "buyer-u-1-acquired-marketplace");
    assert.equal(plan.newCollection!.visibility, "private");
    assert.equal(plan.newCollection!.role, "owner");
  });

  it("(b) returns null newCollection when one already exists — never overwrites the cover", () => {
    const existing: Collection = {
      id: "buyer-u-1-acquired-marketplace",
      name: "Acquired",
      description: "",
      coverPhoto: "https://cdn/original-cover.jpg",
      ownerName: "buyer@example.com",
      ownerUserId: "buyer-u-1",
      sharedWith: [],
      sharedWithUserIds: [],
      role: "owner",
      visibility: "private",
    };
    const plan = planTransferItem(baseInput({ existingCollection: existing }));
    assert.equal(plan.newCollection, null);
    assert.equal(plan.collectionId, "buyer-u-1-acquired-marketplace");
  });

  it("(a) idempotent re-claims of the same source return isDuplicate=true and reuse the existing item", () => {
    const options: AcquiredCollectionOptions = { source: SOURCE };
    const firstPlan = planTransferItem(baseInput({ options }));
    assert.equal(firstPlan.isDuplicate, false);
    const stored: CollectableItem[] = [firstPlan.item];

    // Re-claim: same snapshot, same source, but a *later* `now` to simulate
    // a retried network call seconds later.
    const secondPlan = planTransferItem(
      baseInput({
        options,
        existingItems: stored,
        now: new Date(FROZEN_NOW.getTime() + 60_000),
      }),
    );
    assert.equal(secondPlan.isDuplicate, true);
    assert.equal(secondPlan.item.id, firstPlan.item.id, "re-claim must reuse the stored item id");
    assert.equal(secondPlan.item.createdAt, firstPlan.item.createdAt, "createdAt must not roll forward on re-claim");
    assert.equal(secondPlan.logEntry, null, "duplicate plans skip the log-entry write");
  });

  it("(a) idempotency only applies when source is provided — anonymous transfers always create new items", () => {
    // Two transfers without a source must NOT dedupe, because there's no
    // stable key — every call legitimately creates a new acquired item.
    const first = planTransferItem(baseInput());
    const second = planTransferItem(
      baseInput({
        existingItems: [first.item],
        now: new Date(FROZEN_NOW.getTime() + 1),
      }),
    );
    assert.equal(second.isDuplicate, false);
    assert.notEqual(second.item.id, first.item.id);
  });

  it("emits a logEntry whose itemId points at the new acquired item (audit-trail wiring)", () => {
    const plan = planTransferItem(baseInput({ options: { source: SOURCE } }));
    assert.ok(plan.logEntry, "source-backed plans must produce a logEntry");
    assert.equal(plan.logEntry!.itemId, plan.item.id);
    assert.equal(plan.logEntry!.listingId, SOURCE.listingId);
    assert.equal(plan.logEntry!.sellerUserId, SOURCE.sellerUserId);
    assert.equal(plan.logEntry!.price, 199);
    assert.equal(plan.logEntry!.currency, "USD");
    assert.equal(plan.logEntry!.photo, "https://cdn/photo-a.jpg");
  });

  it("returns null logEntry when no source metadata is supplied", () => {
    const plan = planTransferItem(baseInput());
    assert.equal(plan.logEntry, null);
  });

  it("trims whitespace-only snapshot strings to safe defaults", () => {
    const plan = planTransferItem(
      baseInput({
        snapshot: makeSnapshot({
          title: "   ",
          acquiredFrom: "   ",
          description: undefined,
          variants: undefined,
        }),
      }),
    );
    assert.equal(plan.item.title, "Acquired item");
    assert.equal(plan.item.acquiredFrom, "");
    assert.equal(plan.item.description, "");
    assert.equal(plan.item.variants, "");
  });

  it("derives acquiredAt from the supplied `now` (YYYY-MM-DD) — deterministic on test clock", () => {
    const plan = planTransferItem(baseInput());
    assert.equal(plan.item.acquiredAt, "2026-05-28");
  });

  it("computes the collectionId via the user-scoped helper, not a bespoke template", () => {
    const plan = planTransferItem(baseInput({ ownerUserId: "u-xyz" }));
    assert.equal(plan.collectionId, "u-xyz-acquired-marketplace");
    assert.equal(plan.item.collectionId, "u-xyz-acquired-marketplace");
  });
});
