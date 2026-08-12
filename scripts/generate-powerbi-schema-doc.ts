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

import { ANALYTICS_EVENT_NAMES } from "../lib/analytics-events";
import { injectPowerbiSchemaBlock } from "../lib/powerbi-schema-doc";
import { GuardRootError } from "../lib/guard-root";
import {
  ScannedFloorError,
  assertParsedInputs,
  assertScannedFloor,
} from "../lib/scanned-floor";
import { asText, guardScanRoot, readTextInput } from "./guard-io";

const CHECK_NAME = "generate-powerbi-schema-doc";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const DOC_RELATIVE_PATH = "docs/powerbi-connection.md";

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const docPath = path.join(repoRoot, "docs", "powerbi-connection.md");
  const checkOnly = process.argv.includes("--check");
  const current = readTextInput(docPath);

  // Both halves of the premise, because this guard compares two things and
  // either one being empty makes them agree. An empty taxonomy renders a
  // header-only table that matches a header-only doc, and "up to date" is
  // what a drift check prints when there is no schema left to drift.
  assertParsedInputs(CHECK_NAME, { [DOC_RELATIVE_PATH]: current });
  assertScannedFloor(CHECK_NAME, ANALYTICS_EVENT_NAMES.length);

  const doc = asText(current);
  const regenerated = injectPowerbiSchemaBlock(doc);

  if (regenerated === doc) {
    console.log(
      `${CHECK_NAME}: docs/powerbi-connection.md is up to date (${ANALYTICS_EVENT_NAMES.length} taxonomy event(s) checked).`,
    );
    return;
  }

  if (checkOnly) {
    console.error(
      "generate-powerbi-schema-doc: docs/powerbi-connection.md is out of sync with lib/analytics-events.ts.\n" +
        "Run `npm run powerbi:schema-doc` and commit the result.",
    );
    process.exit(1);
  }

  fs.writeFileSync(docPath, regenerated);
  console.log(`${CHECK_NAME}: rewrote ${docPath}`);
}

try {
  main();
} catch (error) {
  if (error instanceof ScannedFloorError || error instanceof GuardRootError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
