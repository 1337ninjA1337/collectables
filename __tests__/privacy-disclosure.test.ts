import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SUB_PROCESSORS,
  renderRetentionMarkdownTable,
  subProcessorSummaryLines,
} from "../lib/privacy-disclosure";
import { PRIVACY_MANIFEST } from "../lib/privacy-manifest";

const privacyMd = readFileSync(
  path.join(process.cwd(), "PRIVACY.md"),
  "utf8",
);

describe("sub-processor disclosure shape", () => {
  it("declares unique ids and non-empty facts for every sub-processor", () => {
    const ids = SUB_PROCESSORS.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, "sub-processor ids must be unique");
    for (const e of SUB_PROCESSORS) {
      assert.ok(e.name.length > 0, `${e.id} needs a legal name`);
      assert.ok(e.shortName.length > 0, `${e.id} needs a short name`);
      assert.ok(e.dataTypes.length > 0, `${e.id} needs at least one data type`);
      assert.ok(e.retention.length > 0, `${e.id} needs a retention window`);
      for (const url of [e.url, e.privacyUrl, e.dpaUrl].filter(Boolean)) {
        assert.match(
          url as string,
          /^https:\/\//,
          `${e.id} URLs must be https (${url})`,
        );
      }
    }
  });

  it("covers the four core sub-processors plus Clarity", () => {
    const ids = new Set(SUB_PROCESSORS.map((e) => e.id));
    for (const required of [
      "supabase",
      "cloudinary",
      "sentry",
      "posthog",
      "clarity",
    ]) {
      assert.ok(ids.has(required as never), `missing sub-processor: ${required}`);
    }
  });
});

describe("PRIVACY.md parity", () => {
  it("names every sub-processor with its legal entity and links", () => {
    for (const e of SUB_PROCESSORS) {
      assert.ok(
        privacyMd.includes(e.name),
        `PRIVACY.md must name '${e.name}' (${e.id}) — it has drifted from lib/privacy-disclosure.ts`,
      );
      assert.ok(
        privacyMd.includes(e.url),
        `PRIVACY.md must link ${e.url} (${e.id})`,
      );
      assert.ok(
        privacyMd.includes(e.privacyUrl),
        `PRIVACY.md must link the ${e.id} privacy policy ${e.privacyUrl}`,
      );
      if (e.dpaUrl) {
        assert.ok(
          privacyMd.includes(e.dpaUrl),
          `PRIVACY.md must link the ${e.id} DPA ${e.dpaUrl}`,
        );
      }
    }
  });

  it("contains the rendered retention table verbatim", () => {
    assert.ok(
      privacyMd.includes(renderRetentionMarkdownTable()),
      "PRIVACY.md's 'Data retention' table has drifted from lib/privacy-disclosure.ts — update the module and paste the rendered table into PRIVACY.md.",
    );
  });

  it("only telemetry sub-processors appear in the retention table", () => {
    for (const e of SUB_PROCESSORS) {
      const isTelemetry = ["sentry", "posthog", "clarity"].includes(e.id);
      assert.equal(
        Boolean(e.retentionTable),
        isTelemetry,
        `${e.id} retention-table presence must match its telemetry role`,
      );
    }
  });
});

describe("App Privacy manifest parity", () => {
  it("every sub-processor is traceable in a manifest source", () => {
    const sources = PRIVACY_MANIFEST.map((m) => m.source).join("\n");
    for (const e of SUB_PROCESSORS) {
      assert.ok(
        sources.includes(e.shortName),
        `lib/privacy-manifest.ts must mention '${e.shortName}' in a source column — the App Privacy table has drifted from lib/privacy-disclosure.ts`,
      );
    }
  });
});

describe("renderRetentionMarkdownTable", () => {
  it("renders one row per retention-table entry plus two header lines", () => {
    const lines = renderRetentionMarkdownTable().split("\n");
    const expected = SUB_PROCESSORS.filter((e) => e.retentionTable).length;
    assert.equal(lines.length, expected + 2);
    assert.match(lines[0], /^\| Surface \| Store \| Retention window \|$/);
    assert.match(lines[1], /^\| --- \| --- \| --- \|$/);
  });

  it("skips entries without a retentionTable", () => {
    const table = renderRetentionMarkdownTable(
      SUB_PROCESSORS.filter((e) => e.id === "supabase"),
    );
    assert.equal(table.split("\n").length, 2, "prose-only entries render no rows");
  });
});

describe("subProcessorSummaryLines", () => {
  it("flattens name, data types, and retention into three lines", () => {
    const sentry = SUB_PROCESSORS.find((e) => e.id === "sentry")!;
    const lines = subProcessorSummaryLines(sentry);
    assert.equal(lines.length, 3);
    assert.ok(lines[0].includes("Sentry") && lines[0].includes(sentry.url));
    assert.ok(lines[1].startsWith("Data: ") && lines[1].includes("stack traces"));
    assert.equal(lines[2], "Retention: 90 days");
  });
});
