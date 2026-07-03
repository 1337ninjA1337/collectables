import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const DOC = "docs/powerbi-cost-projection.md";
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("docs/powerbi-cost-projection.md", () => {
  it("file exists at the canonical path", () => {
    assert.ok(existsSync(join(ROOT, DOC)));
  });

  const src = read(DOC);

  it("names the concrete Pro tipping point: scheduled refresh at $10/user/month", () => {
    assert.match(src, /scheduled refresh/i);
    assert.match(src, /\$10\/user\/month/);
    assert.match(src, /Pro/);
  });

  it("calls out that every viewer of a published workspace needs a Pro seat", () => {
    assert.match(src, /viewer/i);
    assert.match(src, /\$10 × N|every viewer/i);
  });

  it("covers the higher tiers so the ceiling is visible", () => {
    assert.match(src, /Premium Per User/);
    assert.match(src, /\$20\/user\/month/);
    assert.match(src, /Premium capacity|F2/);
  });

  it("documents what stays free today", () => {
    assert.match(src, /\$0/);
    assert.match(src, /manual refresh/i);
    assert.match(src, /Desktop \(free\)/);
  });

  it("points at the Metabase fallback as the $0 escape hatch", () => {
    assert.match(src, /metabase-connection\.md/);
  });

  it("is linked from the Power BI connection guide", () => {
    assert.match(read("docs/powerbi-connection.md"), /powerbi-cost-projection\.md/);
  });
});
