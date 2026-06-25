import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isRuntimeConfigOverrideAllowed } from "../lib/runtime-config-gate";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("SEC-4 — runtime Supabase config override is gated", () => {
  it("is allowed in a dev build", () => {
    assert.equal(isRuntimeConfigOverrideAllowed(true, undefined), true);
  });

  it("is denied in a production build with no opt-in", () => {
    assert.equal(isRuntimeConfigOverrideAllowed(false, undefined), false);
  });

  it("is allowed in a production build only with the explicit QA opt-in", () => {
    assert.equal(isRuntimeConfigOverrideAllowed(false, "true"), true);
  });

  it("treats any non-\"true\" opt-in value as denied", () => {
    for (const val of ["false", "1", "yes", "TRUE", "", " true "]) {
      assert.equal(
        isRuntimeConfigOverrideAllowed(false, val),
        false,
        `opt-in value ${JSON.stringify(val)} must not enable the override`,
      );
    }
  });

  it("a dev build wins even if the opt-in is explicitly disabled", () => {
    assert.equal(isRuntimeConfigOverrideAllowed(true, "false"), true);
  });
});

describe("SEC-4 — supabase.ts wires the gate into parseRuntimeConfig", () => {
  const src = read("lib/supabase.ts");

  it("imports the gate helper", () => {
    assert.match(
      src,
      /isRuntimeConfigOverrideAllowed.*from\s+["']\.\/runtime-config-gate["']/s,
      "lib/supabase.ts must import the SEC-4 gate",
    );
  });

  it("short-circuits parseRuntimeConfig when the override is not allowed", () => {
    const fn = src.slice(src.indexOf("function parseRuntimeConfig"));
    assert.match(
      fn,
      /if\s*\(\s*!isRuntimeConfigOverrideAllowed\(\)\s*\)\s*return null;/,
      "parseRuntimeConfig must bail out before reading localStorage when the override is gated off",
    );
  });
});
