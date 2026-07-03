#!/usr/bin/env tsx
/**
 * Writes `PrivacyInfo.xcprivacy` (repo root) from the typed declarations in
 * `lib/privacy-manifest.ts`, and prints the Markdown table that
 * APPSTORE-SUBMISSION.md section 6 must contain verbatim.
 *
 * Run `npm run privacy:generate` after changing `PRIVACY_MANIFEST`;
 * `__tests__/privacy-manifest.test.ts` fails CI whenever either artefact
 * drifts from the module.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  renderPrivacyInfoPlist,
  renderPrivacyMarkdownTable,
} from "../lib/privacy-manifest";

const REPO_ROOT = path.join(__dirname, "..");
const PLIST_PATH = path.join(REPO_ROOT, "PrivacyInfo.xcprivacy");

function main(): void {
  fs.writeFileSync(PLIST_PATH, renderPrivacyInfoPlist());
  console.log(`generate-privacy-manifest: wrote ${PLIST_PATH}`);
  console.log(
    "generate-privacy-manifest: APPSTORE-SUBMISSION.md section 6 must contain this table verbatim:\n",
  );
  console.log(renderPrivacyMarkdownTable());
}

main();
