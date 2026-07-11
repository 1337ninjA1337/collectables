import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { isRisingEdge } from "../lib/use-transition-event";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("isRisingEdge — pure edge predicate", () => {
  it("true only for the false → true transition", () => {
    assert.equal(isRisingEdge(false, true), true);
  });

  it("false for every non-rising pair", () => {
    assert.equal(isRisingEdge(false, false), false);
    assert.equal(isRisingEdge(true, true), false);
    assert.equal(isRisingEdge(true, false), false);
  });
});

// The repo has no React mounting harness (see the [needs-dev-dep] tasks in
// .tasks/.tasks.md), so the hook half is pinned structurally: the contract
// lines a refactor is most likely to break are asserted against the source.
describe("useTransitionEvent — structural contract", () => {
  const src = read("lib/use-transition-event.ts");

  it("delegates the edge decision to isRisingEdge (one implementation)", () => {
    assert.match(
      src,
      /if\s*\(\s*isRisingEdge\s*\(\s*prevRef\.current\s*,\s*value\s*\)\s*\)/,
      "the hook must gate fire() on the shared predicate, not re-roll !prev && next",
    );
  });

  it("seeds the baseline from the mount-render value (already-true never fires)", () => {
    assert.match(
      src,
      /useRef\s*\(\s*value\s*\)/,
      "prevRef must initialise with the first-render value so mounting in the true state is not a transition",
    );
  });

  it("keeps fire in a ref and re-arms only on value changes", () => {
    assert.match(
      src,
      /fireRef\.current\s*=\s*fire/,
      "fire must be latest-ref'd so inline closures don't re-arm the effect",
    );
    assert.match(
      src,
      /\},\s*\[value\]\s*\)/,
      "the effect dependency list must be exactly [value]",
    );
  });
});

describe("app/item/[id].tsx — isRisingEdge adoption", () => {
  const src = read("app/item/[id].tsx");

  it("imports isRisingEdge from @/lib/use-transition-event", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bisRisingEdge\b[^}]*\}\s*from\s*["']@\/lib\/use-transition-event["']/,
    );
  });

  it("no longer re-rolls the inline !hadPhotosBefore && gate", () => {
    assert.ok(
      !/!hadPhotosBefore\s*&&/.test(src),
      "the inline edge check must be replaced by isRisingEdge(...)",
    );
  });
});
