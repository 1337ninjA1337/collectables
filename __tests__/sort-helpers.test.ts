import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  byCreatedAtAsc,
  byCreatedAtDesc,
  compareIsoAsc,
  compareIsoDesc,
  compareKeysAsc,
} from "@/lib/sort-helpers";

/**
 * `lib/sort-helpers.ts` exists to close a bug class: fifteen call sites had
 * independently written a timestamp comparator that returns a non-zero value
 * for ties, so `cmp(a, b)` and `cmp(b, a)` shared a sign. That makes the sort
 * result implementation-defined, and the app ships on two engines (V8 on web,
 * Hermes on device) whose sorts are not the same code.
 *
 * The consistency assertions below are the contract; the source sweep at the
 * bottom is what keeps the sixteenth site from being written next month.
 */
const AT = (n: number) => new Date(1767225600000 + n).toISOString();

/** cmp(a,b) and cmp(b,a) must have opposite signs, and ties must be exactly 0. */
function assertConsistent<T>(cmp: (a: T, b: T) => number, a: T, b: T, label: string) {
  const forward = cmp(a, b);
  const backward = cmp(b, a);
  if (forward === 0) {
    assert.equal(backward, 0, `${label}: cmp(a,b)===0 but cmp(b,a)===${backward}`);
    return;
  }
  assert.ok(
    Math.sign(forward) === -Math.sign(backward),
    `${label}: cmp(a,b)=${forward} and cmp(b,a)=${backward} do not have opposite signs`,
  );
}

describe("compareIsoAsc / compareIsoDesc", () => {
  it("orders oldest → newest and newest → oldest", () => {
    assert.ok(compareIsoAsc(AT(0), AT(1)) < 0);
    assert.ok(compareIsoAsc(AT(1), AT(0)) > 0);
    assert.ok(compareIsoDesc(AT(0), AT(1)) > 0);
    assert.ok(compareIsoDesc(AT(1), AT(0)) < 0);
  });

  it("returns exactly 0 for a tie — the whole point of the module", () => {
    assert.equal(compareIsoAsc(AT(0), AT(0)), 0);
    assert.equal(compareIsoDesc(AT(0), AT(0)), 0);
  });

  it("is a consistent comparator in both directions", () => {
    for (const [a, b] of [
      [AT(0), AT(1)],
      [AT(1), AT(0)],
      [AT(0), AT(0)],
    ]) {
      assertConsistent(compareIsoAsc, a, b, "compareIsoAsc");
      assertConsistent(compareIsoDesc, a, b, "compareIsoDesc");
    }
  });

  it("compares ISO strings lexicographically rather than parsing dates", () => {
    // A fixed-offset ISO-8601 string sorts correctly as text, which is why
    // there is no `new Date()` in the module. Crossing a year boundary is the
    // case a naive substring comparison would get wrong.
    assert.ok(compareIsoAsc("2025-12-31T23:59:59.999Z", "2026-01-01T00:00:00.000Z") < 0);
  });
});

describe("byCreatedAtAsc / byCreatedAtDesc", () => {
  const older = { id: "a", createdAt: AT(0) };
  const newer = { id: "b", createdAt: AT(1000) };

  it("reads createdAt off the object", () => {
    assert.ok(byCreatedAtAsc(older, newer) < 0);
    assert.ok(byCreatedAtDesc(older, newer) > 0);
  });

  it("returns 0 for rows minted in the same millisecond", () => {
    assert.equal(byCreatedAtDesc(older, { id: "c", createdAt: AT(0) }), 0);
  });

  it("keeps tied rows in input order across a sort, on any array length", () => {
    // The user-visible symptom of the old comparator: same-millisecond rows
    // (a bulk import, a seed fixture, a chat burst) shuffling between renders
    // with no state change to blame. TimSort switches strategy by length, so
    // this walks past the insertion-sort threshold into the merge path.
    for (const n of [2, 3, 10, 25, 64, 200]) {
      const rows = Array.from({ length: n }, (_, i) => ({ id: i, createdAt: AT(0) }));
      assert.deepEqual(
        [...rows].sort(byCreatedAtDesc).map((r) => r.id),
        rows.map((r) => r.id),
        `byCreatedAtDesc reordered ${n} tied rows`,
      );
      assert.deepEqual(
        [...rows].sort(byCreatedAtAsc).map((r) => r.id),
        rows.map((r) => r.id),
        `byCreatedAtAsc reordered ${n} tied rows`,
      );
    }
  });

  it("keeps ties in input order when they are interleaved with distinct values", () => {
    // Groups of four sharing a timestamp — the shape a bulk import produces.
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: i, createdAt: AT(Math.floor(i / 4)) }));
    const sorted = [...rows].sort(byCreatedAtDesc);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous.createdAt === current.createdAt) {
        assert.ok(previous.id < current.id, `tied rows ${previous.id}/${current.id} swapped`);
      } else {
        assert.ok(previous.createdAt > current.createdAt, "descending order broken");
      }
    }
  });

  it("does not mutate the array it is used on", () => {
    const rows = [newer, older];
    [...rows].sort(byCreatedAtAsc);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["b", "a"],
    );
  });
});

describe("compareKeysAsc", () => {
  it("orders ascending with a real zero for equal keys", () => {
    assert.ok(compareKeysAsc("a", "b") < 0);
    assert.ok(compareKeysAsc("b", "a") > 0);
    assert.equal(compareKeysAsc("a", "a"), 0);
  });

  it("stays byte-ordered rather than locale-aware", () => {
    // Documented as deliberate: this sorts opaque keys, where a stable machine
    // ordering is the point. A collator would sort "Z" before "a".
    assert.ok(compareKeysAsc("Z", "a") < 0);
  });
});

describe("no lib/ module re-inlines an inconsistent timestamp comparator", () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("finds no `? 1 : -1` / `? -1 : 1` timestamp ternary left in lib/, app/ or components/", () => {
    // The exact shape that was wrong at fifteen sites. Matching on the
    // timestamp field names keeps this from firing on the legitimate
    // null-sinking branch in `lib/item-filters.ts`, which handles its own tie.
    const pattern = /(createdAt|soldAt|lastMessageAt|recordedAt|arrivedAt|updatedAt)\s*[<>]\s*\w+\.\w+\s*\?\s*-?1\s*:\s*-?1/;
    const offenders: string[] = [];
    for (const dir of ["lib", "app", "components"]) {
      for (const file of walk(path.join(process.cwd(), dir))) {
        // The helper's own doc comment quotes the bad shape on purpose — it is
        // the thing being explained. Everywhere else, quoting it means using it.
        if (file.endsWith("sort-helpers.ts")) continue;
        const source = readFileSync(file, "utf8");
        source.split("\n").forEach((line, index) => {
          if (pattern.test(line)) {
            offenders.push(`${path.relative(process.cwd(), file)}:${index + 1}  ${line.trim()}`);
          }
        });
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "route these through lib/sort-helpers.ts — a ternary comparator returns non-zero for ties",
    );
  });

  it("has the five migrated modules importing the shared comparators", () => {
    // Adoption, so a future refactor cannot quietly re-inline by deleting the
    // import and restoring the ternary in a shape the regex above misses.
    const expected: [string, string][] = [
      ["lib/home-helpers.ts", "byCreatedAtDesc"],
      ["lib/chat-helpers.ts", "byCreatedAtAsc"],
      ["lib/chat-context.tsx", "byCreatedAtAsc"],
      ["lib/collections-context.tsx", "byCreatedAtDesc"],
      ["lib/marketplace-helpers.ts", "compareIsoDesc"],
      ["lib/db-duplicates.ts", "compareKeysAsc"],
    ];
    for (const [file, symbol] of expected) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      assert.match(
        source,
        new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*"[^"]*sort-helpers"`),
        `${file} should import ${symbol} from lib/sort-helpers`,
      );
    }
  });

  it("keeps the marketplace soldAt fallback in one place", () => {
    // Five surfaces sort by `soldAt ?? createdAt`; the fallback is defined once
    // as `bySoldAtDesc`. A sixth site re-deriving it would drift.
    const source = readFileSync(path.join(process.cwd(), "lib/marketplace-helpers.ts"), "utf8");
    assert.equal(
      (source.match(/function bySoldAtDesc\b/g) ?? []).length,
      1,
      "bySoldAtDesc should be declared exactly once",
    );
    // The two-sided form `a.soldAt ?? a.createdAt` … `b.soldAt ?? b.createdAt`
    // is what a comparator looks like; it must exist on exactly one line. The
    // file's third `soldAt ?? createdAt` is the `recordedAt:` field stamp in
    // the price-history builder, which reads the same fallback but is not a
    // sort and is correct where it is.
    const comparatorLines = source
      .split("\n")
      .filter((line) => /a\.soldAt \?\? a\.createdAt/.test(line) && /b\.soldAt \?\? b\.createdAt/.test(line));
    assert.equal(comparatorLines.length, 1, "a second site re-derived the soldAt fallback");
    assert.ok((source.match(/\.sort\(bySoldAtDesc\)/g) ?? []).length >= 4);
  });
});
