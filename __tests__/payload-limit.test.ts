import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  MAX_PAYLOAD_BYTES,
  declaredContentLength,
  exceedsPayloadLimit,
  utf8ByteLength,
} from "../supabase/functions/_shared/payload-limit";

/**
 * Shared webhook body-size gate (`supabase/functions/_shared/payload-limit.ts`).
 *
 * The helper is pure (TextEncoder global only), so the REAL module is
 * executed here; the adopting Deno function (`analytics-mirror`) gets
 * structural guards at the bottom — same split as `_shared/cors.ts` /
 * `_shared/timing-safe-equal.ts`.
 */

describe("declaredContentLength", () => {
  it("parses a plain numeric header", () => {
    assert.equal(declaredContentLength("1024"), 1024);
  });

  it("tolerates surrounding whitespace", () => {
    assert.equal(declaredContentLength(" 42 "), 42);
  });

  it("returns null for a missing header (chunked encoding sends none)", () => {
    assert.equal(declaredContentLength(null), null);
  });

  it("returns null for blank, non-numeric, negative, or fractional values", () => {
    assert.equal(declaredContentLength(""), null);
    assert.equal(declaredContentLength("abc"), null);
    assert.equal(declaredContentLength("-1"), null);
    assert.equal(declaredContentLength("12.5"), null);
  });

  it("returns null when the value overflows a safe integer", () => {
    assert.equal(declaredContentLength("9".repeat(40)), null);
  });
});

describe("utf8ByteLength", () => {
  it("counts ASCII as one byte per character", () => {
    assert.equal(utf8ByteLength("abc"), 3);
  });

  it("counts multi-byte characters by their UTF-8 encoding, not UTF-16 units", () => {
    // é is 1 UTF-16 code unit but 2 UTF-8 bytes; 🔑 is 2 units, 4 bytes.
    assert.equal(utf8ByteLength("é"), 2);
    assert.equal(utf8ByteLength("🔑"), 4);
  });
});

describe("exceedsPayloadLimit", () => {
  it("caps at 256 KiB by default", () => {
    assert.equal(MAX_PAYLOAD_BYTES, 262144);
    assert.equal(exceedsPayloadLimit(MAX_PAYLOAD_BYTES), false);
    assert.equal(exceedsPayloadLimit(MAX_PAYLOAD_BYTES + 1), true);
  });

  it("honours a custom limit", () => {
    assert.equal(exceedsPayloadLimit(11, 10), true);
    assert.equal(exceedsPayloadLimit(10, 10), false);
  });
});

describe("payload-limit — structural adoption (analytics-mirror)", () => {
  const FN_SOURCE = readFileSync(
    path.join(
      process.cwd(),
      "supabase",
      "functions",
      "analytics-mirror",
      "index.ts",
    ),
    "utf8",
  );

  it("imports the shared gate", () => {
    assert.match(FN_SOURCE, /from\s+['"]\.\.\/_shared\/payload-limit\.ts['"]/);
  });

  it("rejects on the declared Content-Length before reading the body", () => {
    assert.match(
      FN_SOURCE,
      /declaredContentLength\(req\.headers\.get\(['"]content-length['"]\)\)/,
    );
    const declaredIdx = FN_SOURCE.indexOf("declaredContentLength(");
    const readIdx = FN_SOURCE.indexOf("await req.text()");
    assert.ok(declaredIdx >= 0 && readIdx >= 0 && declaredIdx < readIdx);
  });

  it("measures the read body's UTF-8 bytes (header is client-controlled)", () => {
    assert.match(FN_SOURCE, /exceedsPayloadLimit\(utf8ByteLength\(bodyText\)\)/);
  });

  it("responds 413 payload too large with the cap in the body", () => {
    assert.match(FN_SOURCE, /payload too large[\s\S]*?413/);
    assert.match(FN_SOURCE, /maxBytes: MAX_PAYLOAD_BYTES/);
  });

  it("the size gate runs after the secret check (no unauthenticated probing of limits)", () => {
    const secretIdx = FN_SOURCE.indexOf("timingSafeEqualStrings(");
    const gateIdx = FN_SOURCE.indexOf("declaredContentLength(");
    assert.ok(secretIdx >= 0 && gateIdx >= 0 && secretIdx < gateIdx);
  });
});
