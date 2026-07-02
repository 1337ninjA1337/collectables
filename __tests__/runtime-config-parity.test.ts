import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const LIB = join(ROOT, "lib");

/**
 * Scans `lib/*-config.ts` for every `EXPO_PUBLIC_*` env var the runtime config
 * layer reads, and asserts each one is documented in `README-DEPLOY.md`. Today
 * drift between the two is only caught by a human reading both files; tying them
 * together refuses to add a new env-driven knob to `lib/runtime-config.ts`'s
 * source modules without a matching secrets-table row.
 */
const ENV_VAR = /EXPO_PUBLIC_[A-Z0-9_]+/g;

function configEnvVars(): string[] {
  const files = readdirSync(LIB).filter((f) => f.endsWith("-config.ts"));
  const names = new Set<string>();
  for (const file of files) {
    const src = readFileSync(join(LIB, file), "utf8");
    for (const match of src.match(ENV_VAR) ?? []) names.add(match);
  }
  return [...names].sort();
}

describe("runtime-config ↔ README-DEPLOY parity", () => {
  it("finds env vars to check (guards against a broken scanner)", () => {
    const vars = configEnvVars();
    assert.ok(
      vars.length >= 10,
      `expected the config scan to surface the known EXPO_PUBLIC_* vars, got ${vars.length}`,
    );
    // Anchor a couple of known names so an over-broad or empty regex fails loudly.
    assert.ok(vars.includes("EXPO_PUBLIC_SENTRY_DSN"));
    assert.ok(vars.includes("EXPO_PUBLIC_CLOUDINARY_URL"));
  });

  it("documents every lib/*-config.ts EXPO_PUBLIC_* var in README-DEPLOY.md", () => {
    const docs = readFileSync(join(ROOT, "README-DEPLOY.md"), "utf8");
    const missing = configEnvVars().filter(
      (name) => !new RegExp(`\`${name}\``).test(docs),
    );
    assert.deepEqual(
      missing,
      [],
      `README-DEPLOY.md is missing secrets-table rows for: ${missing.join(", ")}`,
    );
  });
});
