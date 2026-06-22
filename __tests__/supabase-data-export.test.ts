import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-26 — structural assertions on the `cloudExportData` client wrapper in
 * `lib/supabase-data-export.ts`. The module imports the app's `@/` alias
 * (react-native / Supabase singletons) so it isn't executed in node; instead we
 * pin the composition contract: it POSTs to the `export-data` endpoint with the
 * user token, coerces the response with `parseDataExport`, and bails to `null`
 * without a real session.
 */

const WRAPPER_PATH = path.join(process.cwd(), "lib", "supabase-data-export.ts");

function readSrc(): string {
  return readFileSync(WRAPPER_PATH, "utf8");
}

describe("cloudExportData — structural composition (BE-26)", () => {
  it("declares cloudExportData(...) returning Promise<DataExportDocument | null>", () => {
    const src = readSrc();
    assert.match(src, /export\s+async\s+function\s+cloudExportData\s*\(/);
    assert.match(src, /cloudExportData[\s\S]*?Promise<DataExportDocument \| null>/);
  });

  it("POSTs to the export-data Edge Function endpoint", () => {
    const src = readSrc();
    assert.match(src, /dataExportUrl\s*\(\s*supabaseUrl!\s*\)/);
    assert.match(src, /method\s*:\s*["']POST["']/);
  });

  it("requires a real user token — bails out (null) when none is available", () => {
    const src = readSrc();
    assert.match(src, /if\s*\(!token\)\s*return null/);
  });

  it("short-circuits to null when Supabase is not configured", () => {
    const src = readSrc();
    assert.match(src, /if\s*\(!isSupabaseConfigured\)\s*return null/);
  });

  it("coerces the response through parseDataExport and never throws", () => {
    const src = readSrc();
    assert.match(src, /return parseDataExport\(await res\.json\(\)\)/);
    assert.match(src, /if\s*\(!res\.ok\)\s*return null/);
    assert.match(src, /catch\s*\(err\)\s*\{[\s\S]*captureException[\s\S]*return null/);
  });

  it("threads the optional fetcher + tokenProvider injection", () => {
    const src = readSrc();
    assert.match(
      src,
      /fetcher\s*=\s*fetch\s+as\s+FetchFn[\s\S]*?tokenProvider\s*=\s*getAccessToken/,
    );
  });

  it("reuses the BE-26 pure shape helpers (single source of truth)", () => {
    const src = readSrc();
    assert.match(src, /from "@\/lib\/data-export"/);
    assert.match(src, /dataExportUrl/);
    assert.match(src, /parseDataExport/);
  });
});
