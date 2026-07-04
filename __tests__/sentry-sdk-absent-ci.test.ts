import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * The `sentry-sdk-absent` CI job runs the sentry test surface with the whole
 * `@sentry` scope deleted from node_modules — the runtime complement to the
 * structural no-static-import guard (`lint:peer-dep-free`). These assertions
 * keep the job's two load-bearing details from regressing.
 */
describe("ci.yml — sentry-sdk-absent smoke job", () => {
  const ci = read(".github/workflows/ci.yml");

  it("defines the job", () => {
    assert.match(ci, /sentry-sdk-absent:/);
  });

  it("deletes the whole @sentry scope (not just @sentry/react-native) to catch transitive imports", () => {
    assert.match(ci, /rm -rf node_modules\/@sentry\s*$/m);
  });

  it("runs the sentry glob WITH the global test-setup import (without it, module-state leaks produce false failures)", () => {
    assert.match(
      ci,
      /npx tsx --import \.\/__tests__\/test-globals\.ts --test __tests__\/sentry-\*\.test\.ts/,
    );
  });

  it("the setup file it references exists", () => {
    assert.doesNotThrow(() => read("__tests__/test-globals.ts"));
  });
});
