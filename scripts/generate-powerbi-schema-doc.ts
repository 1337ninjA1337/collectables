#!/usr/bin/env tsx
/**
 * Regenerates the marker-delimited schema-reference table in
 * `docs/powerbi-connection.md` from the typed taxonomy in
 * `lib/analytics-events.ts`.
 *
 *   npm run powerbi:schema-doc          # rewrite the doc in place
 *   npm run lint:powerbi-doc            # --check: exit 1 when the doc drifts
 *
 * `lint:ci` runs the --check mode so an event added to the union without a
 * doc regen fails CI instead of becoming an "unknown column" in Power Query.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { injectPowerbiSchemaBlock } from "../lib/powerbi-schema-doc";

const DOC_PATH = path.join(__dirname, "..", "docs", "powerbi-connection.md");

function main(): void {
  const checkOnly = process.argv.includes("--check");
  const current = fs.readFileSync(DOC_PATH, "utf8");
  const regenerated = injectPowerbiSchemaBlock(current);

  if (regenerated === current) {
    console.log("generate-powerbi-schema-doc: docs/powerbi-connection.md is up to date");
    return;
  }

  if (checkOnly) {
    console.error(
      "generate-powerbi-schema-doc: docs/powerbi-connection.md is out of sync with lib/analytics-events.ts.\n" +
        "Run `npm run powerbi:schema-doc` and commit the result.",
    );
    process.exit(1);
  }

  fs.writeFileSync(DOC_PATH, regenerated);
  console.log(`generate-powerbi-schema-doc: rewrote ${DOC_PATH}`);
}

main();
